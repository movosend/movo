import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ApiError, OfferStatus, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient, FakePaymentsClient } from "./fake-payments-client";

/**
 * MOVO-331 (ADR-055): `POST /internal/admin/shipments/:id/force-status`. Postgres y Redis reales, payments
 * con el fake. Una prueba por cada celda de `FORCED_TRANSITION_MATRIX` y por cada rechazo.
 */

const AGREED_PRICE = 1150;
const REASON = "El transportista no responde hace dos días y el emisor pidió destrabarlo";

const FAR_WINDOW = {
  pickupDate: new Date("2031-06-01T00:00:00.000Z"),
  pickupTimeWindowStart: new Date("1970-01-01T14:00:00.000Z"),
  pickupTimeWindowEnd: new Date("1970-01-01T18:00:00.000Z"),
};

type S = ShipmentStatus;

describe("cambio forzado de estado de un envío (Postgres + Redis) — MOVO-331", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let payments: FakePaymentsClient;
  const sendPush = vi.fn().mockResolvedValue(undefined);
  const sendAlert = vi.fn().mockResolvedValue(undefined);

  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();
  const adminId = randomUUID();
  const adminName = "Lucía Admin";

  const baseInput: CreateShipmentInput = {
    senderId,
    receiverId,
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: "Caja con libros",
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.1811,
    ...FAR_WINDOW,
    suggestedPriceArs: 1000,
  };

  const WITH_CARRIER: readonly S[] = [
    ShipmentStatus.ASSIGNMENT_PENDING,
    ShipmentStatus.ASSIGNED_UNFUNDED,
    ShipmentStatus.ASSIGNED,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.COMPLETED,
    ShipmentStatus.DISPUTED,
  ];

  /**
   * Envío en `status` (fixture: bypasea la máquina de estados). Con transportista, tiene su oferta
   * aceptada; `withHold` crea además el hold (autorizado por defecto en el fake).
   */
  async function createShipment(status: S, { withHold = false }: { withHold?: boolean } = {}) {
    const created = await shipmentRepo.create(baseInput);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    const hasCarrier = WITH_CARRIER.includes(status);
    await app.db.shipment.update({
      where: { id: created.id },
      data: {
        status,
        lastStatusChangedAt: new Date(),
        ...(hasCarrier && { carrierId, agreedPriceArs: AGREED_PRICE }),
        ...(status === ShipmentStatus.DELIVERED && { deliveredAt: new Date() }),
      },
    });
    if (hasCarrier) {
      await app.db.offer.create({
        data: {
          shipmentId: created.id,
          carrierId,
          priceOffered: AGREED_PRICE,
          offeredDate: FAR_WINDOW.pickupDate,
          status: OfferStatus.ACCEPTED,
          carrierNameAtOffer: "Juan P.",
        },
      });
    }
    if (withHold) {
      await payments.createHold({
        shipmentId: created.id,
        carrierId,
        cardToken: "tok",
        amountArs: AGREED_PRICE,
        payerEmail: "emisor@example.com",
        payerUserId: senderId,
      });
    }
    return created.id;
  }

  const force = (shipmentId: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: `/internal/admin/shipments/${shipmentId}/force-status`,
      payload: { expectedStatus: undefined, reason: REASON, adminId, adminName, idempotencyKey: randomUUID(), ...payload },
    });

  const shipmentRow = (id: string) => app.db.shipment.findUniqueOrThrow({ where: { id } });
  const lastEvent = (id: string) =>
    app.db.shipmentEvent.findFirstOrThrow({ where: { shipmentId: id }, orderBy: { createdAt: "desc" } });
  const eventCount = (id: string) => app.db.shipmentEvent.count({ where: { shipmentId: id } });

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    payments = createFakePaymentsClient();
    app = buildApp({
      usersClient: createFakeUsersClient({}),
      notificationsClient: { sendPush },
      paymentsClient: payments,
      alertNotifier: { send: sendAlert },
      sweepEnabled: false,
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments, shipments.trips RESTART IDENTITY CASCADE");
    sendPush.mockClear();
    sendAlert.mockClear();
    payments.holds.clear();
    payments.settlements.clear();
    payments.behavior.releaseError = null;
    payments.behavior.captureError = null;
    payments.behavior.nextHoldStatus = "authorized";
    vi.mocked(payments.releaseHold).mockClear();
    vi.mocked(payments.captureHold).mockClear();
  });

  // [origen, destino, kind esperado, necesita hold]
  const ALLOWED: ReadonlyArray<readonly [S, S, "manual" | "forced", boolean]> = [
    [ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION, ShipmentStatus.CANCELLED, "manual", false],
    [ShipmentStatus.PUBLISHED, ShipmentStatus.CANCELLED, "manual", false],
    [ShipmentStatus.REJECTED_BY_RECEIVER, ShipmentStatus.CANCELLED, "manual", false],
    [ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.PUBLISHED, "forced", false],
    [ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.ASSIGNED, "manual", true],
    [ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.CANCELLED, "manual", false],
    [ShipmentStatus.ASSIGNED_UNFUNDED, ShipmentStatus.PUBLISHED, "forced", false],
    [ShipmentStatus.ASSIGNED_UNFUNDED, ShipmentStatus.ASSIGNED, "manual", true],
    [ShipmentStatus.ASSIGNED_UNFUNDED, ShipmentStatus.CANCELLED, "manual", false],
    [ShipmentStatus.ASSIGNED, ShipmentStatus.PUBLISHED, "forced", true],
    [ShipmentStatus.ASSIGNED, ShipmentStatus.CANCELLED, "forced", true],
    [ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED, "manual", true],
  ];

  describe.each(ALLOWED)("%s -> %s", (from, to, kind, withHold) => {
    it(`ejecuta el servicio de dominio, deja el evento ${kind} y avisa a las partes`, async () => {
      const id = await createShipment(from, { withHold });
      const hasCarrier = WITH_CARRIER.includes(from);

      const response = await force(id, { targetStatus: to, expectedStatus: from });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ shipmentId: id, fromStatus: from, toStatus: to, kind, replayed: false });
      expect((await shipmentRow(id)).status).toBe(to);

      // El evento: inmutable, con el admin, el motivo y el par origen -> destino.
      const event = await lastEvent(id);
      expect(event).toMatchObject({ fromStatus: from, toStatus: to, kind, actorId: adminId, actorName: adminName });
      expect(event.reason).toBeTruthy();

      // Aviso crítico a las partes (el transportista según el snapshot de antes del cambio), sin el motivo.
      // Los servicios de dominio mandan además sus propios avisos (oferta cerrada, etc.), normales: acá solo los de soporte.
      const forcedPushes = sendPush.mock.calls.filter(([input]) => /^Soporte actualizó/.test(input.title));
      const pushed = new Set(forcedPushes.map(([input]) => input.userId as string));
      expect(pushed).toContain(senderId);
      expect(pushed).toContain(receiverId);
      if (hasCarrier) expect(pushed).toContain(carrierId);
      for (const [input] of forcedPushes) {
        expect(input.ignorePreferences).toBe(true);
        expect(input.body).not.toContain(REASON);
        expect(input.body).not.toMatch(/\$|ARS/);
      }
    });
  });

  describe("efectos propios de cada servicio de dominio", () => {
    it("assigned -> cancelled libera el hold y no cobra penalidad ni deja deuda", async () => {
      const id = await createShipment(ShipmentStatus.ASSIGNED, { withHold: true });

      const response = await force(id, { targetStatus: ShipmentStatus.CANCELLED, expectedStatus: ShipmentStatus.ASSIGNED });

      expect(response.statusCode).toBe(200);
      expect(payments.releaseHold).toHaveBeenCalledTimes(1);
      expect(payments.holds.get(id)?.status).toBe("cancelled");
      expect(payments.captureHold).not.toHaveBeenCalled();
      const row = await shipmentRow(id);
      expect(row.cancellationPenaltyArs).toBeNull();
    });

    it("assigned -> published desasigna al transportista, libera el hold y condona la penalidad", async () => {
      const id = await createShipment(ShipmentStatus.ASSIGNED, { withHold: true });

      const response = await force(id, { targetStatus: ShipmentStatus.PUBLISHED, expectedStatus: ShipmentStatus.ASSIGNED });

      expect(response.statusCode).toBe(200);
      const row = await shipmentRow(id);
      expect(row.carrierId).toBeNull();
      expect(payments.holds.get(id)?.status).toBe("cancelled");
      const offer = await app.db.offer.findFirstOrThrow({ where: { shipmentId: id, carrierId } });
      expect(offer.status).toBe(OfferStatus.CARRIER_WITHDRAWN);
      expect(payments.ledgerEntries.size).toBe(0);
    });

    it("assignment_pending -> assigned deja el estado y no toca el hold", async () => {
      const id = await createShipment(ShipmentStatus.ASSIGNMENT_PENDING, { withHold: true });

      await force(id, { targetStatus: ShipmentStatus.ASSIGNED, expectedStatus: ShipmentStatus.ASSIGNMENT_PENDING });

      expect(payments.releaseHold).not.toHaveBeenCalled();
      expect(payments.holds.get(id)?.status).toBe("authorized");
    });

    it("delivered -> completed captura el hold", async () => {
      const id = await createShipment(ShipmentStatus.DELIVERED, { withHold: true });

      await force(id, { targetStatus: ShipmentStatus.COMPLETED, expectedStatus: ShipmentStatus.DELIVERED });

      expect(payments.captureHold).toHaveBeenCalledWith(id);
    });
  });

  describe("transición bloqueada", () => {
    const BLOCKED: ReadonlyArray<readonly [S, S]> = [
      [ShipmentStatus.DISPUTED, ShipmentStatus.PUBLISHED],
      [ShipmentStatus.DISPUTED, ShipmentStatus.COMPLETED],
      [ShipmentStatus.COMPLETED, ShipmentStatus.CANCELLED],
      [ShipmentStatus.CANCELLED, ShipmentStatus.PUBLISHED],
      [ShipmentStatus.ASSIGNED, ShipmentStatus.IN_TRANSIT],
      [ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED],
      [ShipmentStatus.IN_TRANSIT, ShipmentStatus.CANCELLED],
      [ShipmentStatus.PUBLISHED, ShipmentStatus.DISPUTED],
      [ShipmentStatus.PUBLISHED, ShipmentStatus.ASSIGNED],
      [ShipmentStatus.ASSIGNED, ShipmentStatus.ASSIGNED_UNFUNDED],
    ];

    it.each(BLOCKED)("%s -> %s: 422 TRANSITION_NOT_ALLOWED con el motivo, sin tocar nada", async (from, to) => {
      const id = await createShipment(from, { withHold: WITH_CARRIER.includes(from) });
      const eventsBefore = await eventCount(id);

      const response = await force(id, { targetStatus: to, expectedStatus: from });

      expect(response.statusCode).toBe(422);
      const { error } = response.json();
      expect(error.code).toBe("TRANSITION_NOT_ALLOWED");
      expect(error.details.reason).toEqual(expect.any(String));
      expect((await shipmentRow(id)).status).toBe(from);
      expect(await eventCount(id)).toBe(eventsBefore);
      expect(sendPush).not.toHaveBeenCalled();
      expect(payments.releaseHold).not.toHaveBeenCalled();
    });
  });

  describe("concurrencia", () => {
    it("409 STATUS_CHANGED con el estado actual si el envío ya no está en expectedStatus", async () => {
      const id = await createShipment(ShipmentStatus.PUBLISHED);

      const response = await force(id, { targetStatus: ShipmentStatus.CANCELLED, expectedStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toMatchObject({ code: "STATUS_CHANGED", details: { currentStatus: ShipmentStatus.PUBLISHED } });
      expect((await shipmentRow(id)).status).toBe(ShipmentStatus.PUBLISHED);
    });

    it("dos cambios simultáneos no se pisan: uno gana y el otro recibe 409", async () => {
      const id = await createShipment(ShipmentStatus.PUBLISHED);

      const [a, b] = await Promise.all([
        force(id, { targetStatus: ShipmentStatus.CANCELLED, expectedStatus: ShipmentStatus.PUBLISHED }),
        force(id, { targetStatus: ShipmentStatus.CANCELLED, expectedStatus: ShipmentStatus.PUBLISHED }),
      ]);

      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
      const events = await app.db.shipmentEvent.count({ where: { shipmentId: id, toStatus: ShipmentStatus.CANCELLED } });
      expect(events).toBe(1);
    });

    it("404 si el envío no existe", async () => {
      const response = await force(randomUUID(), { targetStatus: ShipmentStatus.CANCELLED, expectedStatus: ShipmentStatus.PUBLISHED });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("verificación del hold", () => {
    it("assigned_unfunded -> assigned con el hold en revisión: 422 HOLD_NOT_AUTHORIZED, el estado no cambia", async () => {
      payments.behavior.nextHoldStatus = "in_process";
      const id = await createShipment(ShipmentStatus.ASSIGNED_UNFUNDED, { withHold: true });

      const response = await force(id, { targetStatus: ShipmentStatus.ASSIGNED, expectedStatus: ShipmentStatus.ASSIGNED_UNFUNDED });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("HOLD_NOT_AUTHORIZED");
      expect((await shipmentRow(id)).status).toBe(ShipmentStatus.ASSIGNED_UNFUNDED);
      expect(sendPush).not.toHaveBeenCalled();
    });

    it("assignment_pending -> assigned sin hold: 422 HOLD_NOT_AUTHORIZED", async () => {
      const id = await createShipment(ShipmentStatus.ASSIGNMENT_PENDING);

      const response = await force(id, { targetStatus: ShipmentStatus.ASSIGNED, expectedStatus: ShipmentStatus.ASSIGNMENT_PENDING });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("HOLD_NOT_AUTHORIZED");
    });
  });

  describe("falla de un efecto externo", () => {
    it("assigned -> cancelled con payments caído: 502, el envío queda assigned, sin evento ni aviso a las partes, con alerta al equipo", async () => {
      const id = await createShipment(ShipmentStatus.ASSIGNED, { withHold: true });
      payments.behavior.releaseError = new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "payments caído");
      const eventsBefore = await eventCount(id);

      const response = await force(id, { targetStatus: ShipmentStatus.CANCELLED, expectedStatus: ShipmentStatus.ASSIGNED });

      expect(response.statusCode).toBe(502);
      expect(response.json().error.code).toBe("FORCE_STATUS_EFFECT_FAILED");
      expect((await shipmentRow(id)).status).toBe(ShipmentStatus.ASSIGNED);
      expect(payments.holds.get(id)?.status).toBe("authorized");
      expect(await eventCount(id)).toBe(eventsBefore);
      expect(sendPush).not.toHaveBeenCalled();
      expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "force_status_failed" }));
    });

    it("delivered -> completed con la captura fallida: 502 y el envío sigue delivered", async () => {
      const id = await createShipment(ShipmentStatus.DELIVERED, { withHold: true });
      payments.behavior.captureError = new ApiError(502, "PAYMENT_PROVIDER_ERROR", "MP no respondió");

      const response = await force(id, { targetStatus: ShipmentStatus.COMPLETED, expectedStatus: ShipmentStatus.DELIVERED });

      expect(response.statusCode).toBe(502);
      expect((await shipmentRow(id)).status).toBe(ShipmentStatus.DELIVERED);
      expect(sendAlert).toHaveBeenCalledTimes(1);
    });

    it("tras la falla se puede reintentar con la misma clave", async () => {
      const id = await createShipment(ShipmentStatus.ASSIGNED, { withHold: true });
      const idempotencyKey = randomUUID();
      payments.behavior.releaseError = new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "payments caído");
      const payload = { targetStatus: ShipmentStatus.CANCELLED, expectedStatus: ShipmentStatus.ASSIGNED, idempotencyKey };

      expect((await force(id, payload)).statusCode).toBe(502);
      payments.behavior.releaseError = null;
      const retry = await force(id, payload);

      expect(retry.statusCode).toBe(200);
      expect(retry.json().replayed).toBe(false);
      expect((await shipmentRow(id)).status).toBe(ShipmentStatus.CANCELLED);
    });
  });

  describe("idempotencia", () => {
    it("repetir la misma clave devuelve el resultado original sin volver a ejecutar efectos", async () => {
      const id = await createShipment(ShipmentStatus.ASSIGNED, { withHold: true });
      const payload = {
        targetStatus: ShipmentStatus.CANCELLED,
        expectedStatus: ShipmentStatus.ASSIGNED,
        idempotencyKey: randomUUID(),
      };

      const first = await force(id, payload);
      const pushesAfterFirst = sendPush.mock.calls.length;
      const eventsAfterFirst = await eventCount(id);
      const second = await force(id, payload);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ ...first.json(), replayed: true });
      expect(payments.releaseHold).toHaveBeenCalledTimes(1);
      expect(sendPush.mock.calls.length).toBe(pushesAfterFirst);
      expect(await eventCount(id)).toBe(eventsAfterFirst);
    });

    it("con otra clave y el estado ya cambiado: 409 STATUS_CHANGED", async () => {
      const id = await createShipment(ShipmentStatus.PUBLISHED);
      const payload = { targetStatus: ShipmentStatus.CANCELLED, expectedStatus: ShipmentStatus.PUBLISHED };

      await force(id, { ...payload, idempotencyKey: randomUUID() });
      const second = await force(id, { ...payload, idempotencyKey: randomUUID() });

      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe("STATUS_CHANGED");
    });

    it("la misma clave para otro envío: 409 IDEMPOTENCY_KEY_REUSED", async () => {
      const idempotencyKey = randomUUID();
      const first = await createShipment(ShipmentStatus.PUBLISHED);
      const other = await createShipment(ShipmentStatus.PUBLISHED);
      const payload = { targetStatus: ShipmentStatus.CANCELLED, expectedStatus: ShipmentStatus.PUBLISHED, idempotencyKey };

      await force(first, payload);
      const response = await force(other, payload);

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect((await shipmentRow(other)).status).toBe(ShipmentStatus.PUBLISHED);
    });
  });

  describe("validación del body", () => {
    it("un motivo de menos de 20 caracteres es 400", async () => {
      const id = await createShipment(ShipmentStatus.PUBLISHED);
      const response = await force(id, { targetStatus: ShipmentStatus.CANCELLED, expectedStatus: ShipmentStatus.PUBLISHED, reason: "muy corto" });
      expect(response.statusCode).toBe(400);
    });

    it("un motivo de solo espacios es 400", async () => {
      const id = await createShipment(ShipmentStatus.PUBLISHED);
      const response = await force(id, {
        targetStatus: ShipmentStatus.CANCELLED,
        expectedStatus: ShipmentStatus.PUBLISHED,
        reason: " ".repeat(30),
      });
      expect(response.statusCode).toBe(400);
    });

    it("un estado desconocido es 400", async () => {
      const id = await createShipment(ShipmentStatus.PUBLISHED);
      const response = await force(id, { targetStatus: "volando", expectedStatus: ShipmentStatus.PUBLISHED });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("línea de tiempo para las partes", () => {
    it("el emisor ve que fue soporte (kind) pero no el motivo ni quién fue", async () => {
      const id = await createShipment(ShipmentStatus.PUBLISHED);
      await force(id, { targetStatus: ShipmentStatus.CANCELLED, expectedStatus: ShipmentStatus.PUBLISHED });

      const events = await app.inject({ method: "GET", url: `/shipments/${id}/events`, headers: { "x-user-id": senderId } });

      expect(events.statusCode).toBe(200);
      const forced = (events.json() as Array<Record<string, unknown>>).at(-1);
      expect(forced).toMatchObject({ toStatus: ShipmentStatus.CANCELLED, kind: "manual", actorId: null, reason: null });
      expect(JSON.stringify(events.json())).not.toContain(adminName);
    });

    it("el panel ve el evento con el admin, el motivo y el par origen -> destino", async () => {
      const id = await createShipment(ShipmentStatus.PUBLISHED);
      await force(id, { targetStatus: ShipmentStatus.CANCELLED, expectedStatus: ShipmentStatus.PUBLISHED });

      const events = await app.inject({ method: "GET", url: `/internal/admin/shipments/${id}/events` });

      expect(events.statusCode).toBe(200);
      expect((events.json() as Array<Record<string, unknown>>).at(-1)).toMatchObject({
        fromStatus: ShipmentStatus.PUBLISHED,
        toStatus: ShipmentStatus.CANCELLED,
        kind: "manual",
        actorId: adminId,
        actorName: adminName,
        reason: REASON,
      });
    });
  });
});
