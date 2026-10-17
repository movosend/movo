import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ApiError, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient, FakePaymentsClient } from "./fake-payments-client";

const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const AGREED_PRICE = 1150;
const PENALTY = 287.5;

/** Ventana de retiro con la forma de las columnas (`@db.Date` + `@db.Time`, reloj argentino anclado a UTC). */
function windowColumns(start: Date, end: Date) {
  const wallStart = new Date(start.getTime() - AR_OFFSET_MS);
  const wallEnd = new Date(end.getTime() - AR_OFFSET_MS);
  const time = (d: Date) => new Date(Date.UTC(1970, 0, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  return {
    pickupDate: new Date(Date.UTC(wallStart.getUTCFullYear(), wallStart.getUTCMonth(), wallStart.getUTCDate())),
    pickupTimeWindowStart: time(wallStart),
    pickupTimeWindowEnd: time(wallEnd),
  };
}

/** Retiro dentro de 1 h: menos de 12 h, ventana abierta (cierra a las 23:59:59 de ese día). */
function lateWindow() {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const wallStart = new Date(start.getTime() - AR_OFFSET_MS);
  const endOfDay = new Date(
    Date.UTC(wallStart.getUTCFullYear(), wallStart.getUTCMonth(), wallStart.getUTCDate(), 23, 59, 59) + AR_OFFSET_MS
  );
  return windowColumns(start, endOfDay);
}

const FAR_WINDOW = {
  pickupDate: new Date("2030-01-01T00:00:00.000Z"),
  pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
  pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
};

const CLOSED_WINDOW = { ...FAR_WINDOW, pickupDate: new Date("2020-01-01T00:00:00.000Z") };

describe("cancelación con penalidad desde assigned (Postgres) — MOVO-307", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let payments: FakePaymentsClient;
  const sendPush = vi.fn().mockResolvedValue(undefined);

  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();

  const baseShipmentInput: CreateShipmentInput = {
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
    suggestedPriceArs: AGREED_PRICE,
  };

  /** Envío `assigned` con su oferta aceptada, precio acordado y hold autorizado (fixture: bypasea la máquina de estados). */
  async function createAssigned(window = lateWindow(), status: ShipmentStatus = ShipmentStatus.ASSIGNED): Promise<string> {
    const created = await shipmentRepo.create(baseShipmentInput);
    await app.db.shipment.update({
      where: { id: created.id },
      data: { status, carrierId, agreedPriceArs: AGREED_PRICE, lastStatusChangedAt: new Date(), ...window },
    });
    await app.db.offer.create({
      data: {
        shipmentId: created.id,
        carrierId,
        priceOffered: AGREED_PRICE,
        offeredDate: window.pickupDate,
        status: "accepted",
      },
    });
    await payments.createHold({
      shipmentId: created.id,
      carrierId,
      cardToken: "tok",
      amountArs: AGREED_PRICE,
      payerEmail: "emisor@example.com",
      payerUserId: senderId,
    });
    return created.id;
  }

  const cancel = (shipmentId: string, payload: Record<string, unknown> = {}, userId = senderId) =>
    app.inject({ method: "POST", url: `/shipments/${shipmentId}/cancel`, headers: { "x-user-id": userId }, payload });

  const quote = (shipmentId: string, userId = senderId) =>
    app.inject({ method: "GET", url: `/shipments/${shipmentId}/cancellation-quote`, headers: { "x-user-id": userId } });

  const pushTitlesTo = (userId: string) =>
    sendPush.mock.calls.filter(([input]) => input.userId === userId).map(([input]) => input.title as string);

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    payments = createFakePaymentsClient();
    app = buildApp({
      usersClient: createFakeUsersClient({}),
      notificationsClient: { sendPush },
      paymentsClient: payments,
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    sendPush.mockClear();
    payments.holds.clear();
    payments.settlements.clear();
    payments.ledgerEntries.clear();
    payments.behavior.captureError = null;
    payments.behavior.releaseError = null;
    vi.mocked(payments.captureHold).mockClear();
  });

  describe("GET /shipments/:id/cancellation-quote", () => {
    it("con 12 h o más es sin cargo y dice hasta cuándo", async () => {
      const shipmentId = await createAssigned(FAR_WINDOW);

      const response = await quote(shipmentId);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ penaltyArs: 0, reason: "before_free_deadline" });
      expect(response.json().freeUntil).toBe("2030-01-01T00:00:00.000Z");
    });

    it("con menos de 12 h cobra el 25 % del precio acordado", async () => {
      const shipmentId = await createAssigned();

      const response = await quote(shipmentId);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ penaltyArs: PENALTY, reason: "late_cancellation" });
    });

    it("con la ventana ya cerrada es sin cargo", async () => {
      const shipmentId = await createAssigned(CLOSED_WINDOW);

      expect((await quote(shipmentId)).json()).toMatchObject({ penaltyArs: 0, reason: "pickup_window_closed" });
    });

    it("antes de assigned no hay penalidad", async () => {
      const shipmentId = await createAssigned(lateWindow(), ShipmentStatus.ASSIGNMENT_PENDING);

      expect((await quote(shipmentId)).json()).toEqual({ penaltyArs: 0, reason: "not_assigned", freeUntil: null });
    });

    it("solo el emisor (403) y solo sobre un envío cancelable (409)", async () => {
      const shipmentId = await createAssigned();
      expect((await quote(shipmentId, receiverId)).statusCode).toBe(403);

      const inTransit = await createAssigned(lateWindow(), ShipmentStatus.IN_TRANSIT);
      const response = await quote(inTransit);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_INVALID_TRANSITION");
    });
  });

  describe("POST /shipments/:id/cancel desde assigned", () => {
    it("con penalidad: cancela, captura parte del hold, registra deuda y cobro y avisa a las dos partes", async () => {
      const shipmentId = await createAssigned();

      const response = await cancel(shipmentId, { expectedPenaltyArs: PENALTY });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: ShipmentStatus.CANCELLED,
        cancellationPenaltyArs: PENALTY,
        cancellationPenaltyStatus: "captured",
      });
      expect(payments.captureHold).toHaveBeenCalledWith(shipmentId, { kind: "cancellation_penalty", amountArs: PENALTY });
      expect(payments.holds.get(shipmentId)?.status).toBe("captured");

      // AC9: la deuda y su cobro, así el saldo del emisor queda en cero.
      expect(payments.ledgerEntries.get(`penalty:${shipmentId}`)).toMatchObject({
        userId: senderId,
        type: "cancellation_penalty",
        amountArs: PENALTY,
        status: "pending",
        roleAtOrigin: "sender",
      });
      expect(payments.ledgerEntries.get(`penalty_capture:${shipmentId}`)).toMatchObject({
        userId: senderId,
        type: "penalty_capture",
        amountArs: -PENALTY,
        status: "settled",
      });

      expect(pushTitlesTo(carrierId)).toContain("Recibiste una compensación");
      expect(pushTitlesTo(senderId)).toContain("Cobramos la penalidad por cancelar");
      // Con la compensación ya avisada, no se le manda además "Tu oferta fue cancelada".
      expect(pushTitlesTo(carrierId)).not.toContain("Tu oferta fue cancelada");

      // AC5: el emisor ve el monto cobrado; el transportista, el desglose de su compensación.
      const asSender = await app.inject({ method: "GET", url: `/shipments/${shipmentId}/settlement`, headers: { "x-user-id": senderId } });
      expect(asSender.json()).toMatchObject({ role: "sender", kind: "cancellation_penalty", paidAmountArs: PENALTY, status: "credited" });
      expect(asSender.json().netAmountArs).toBeUndefined();
      const asCarrier = await app.inject({ method: "GET", url: `/shipments/${shipmentId}/settlement`, headers: { "x-user-id": carrierId } });
      expect(asCarrier.json()).toMatchObject({ role: "carrier", kind: "cancellation_penalty", commissionArs: 149.5 });
      expect(asCarrier.json().netAmountArs).toBeGreaterThan(0);
    });

    it("AC3: un monto distinto del que corresponde es 409 con el monto vigente y no cancela", async () => {
      const shipmentId = await createAssigned();

      const response = await cancel(shipmentId);

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toMatchObject({ code: "CANCELLATION_PENALTY_MISMATCH", details: { penaltyArs: PENALTY } });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED);
      expect(payments.captureHold).not.toHaveBeenCalled();
    });

    it("sin cargo con 12 h o más: libera el hold entero y no toca la cuenta corriente", async () => {
      const shipmentId = await createAssigned(FAR_WINDOW);

      const response = await cancel(shipmentId);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: ShipmentStatus.CANCELLED, cancellationPenaltyArs: null, cancellationPenaltyStatus: null });
      expect(payments.holds.get(shipmentId)?.status).toBe("cancelled");
      expect(payments.captureHold).not.toHaveBeenCalled();
      expect(payments.ledgerEntries.size).toBe(0);
    });

    it("sin cargo con la ventana cerrada, aunque el cliente confirme un monto viejo es 409", async () => {
      const shipmentId = await createAssigned(CLOSED_WINDOW);

      const stale = await cancel(shipmentId, { expectedPenaltyArs: PENALTY });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.details).toEqual({ penaltyArs: 0 });

      const response = await cancel(shipmentId, { expectedPenaltyArs: 0 });
      expect(response.statusCode).toBe(200);
      expect(payments.holds.get(shipmentId)?.status).toBe("cancelled");
    });

    it("plan B: si la penalidad no cubre la comisión del hold más el fee de MP, libera el hold y la deja como deuda", async () => {
      const shipmentId = await createAssigned();
      const hold = payments.holds.get(shipmentId)!;
      payments.holds.set(shipmentId, { ...hold, applicationFeeArs: 400 });

      const response = await cancel(shipmentId, { expectedPenaltyArs: PENALTY });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: ShipmentStatus.CANCELLED, cancellationPenaltyStatus: "debt" });
      expect(payments.holds.get(shipmentId)?.status).toBe("cancelled");
      expect(payments.ledgerEntries.get(`penalty:${shipmentId}`)?.amountArs).toBe(PENALTY);
      expect(payments.ledgerEntries.has(`penalty_capture:${shipmentId}`)).toBe(false);
      expect(pushTitlesTo(senderId)).toContain("Tenés una penalidad pendiente");
      expect(pushTitlesTo(carrierId)).not.toContain("Recibiste una compensación");
      expect(pushTitlesTo(carrierId)).toContain("Tu oferta fue cancelada");
    });

    it("hold vencido o inexistente: la penalidad queda como deuda", async () => {
      const shipmentId = await createAssigned();
      payments.holds.delete(shipmentId);

      const response = await cancel(shipmentId, { expectedPenaltyArs: PENALTY });

      expect(response.statusCode).toBe(200);
      expect(response.json().cancellationPenaltyStatus).toBe("debt");
      expect(payments.ledgerEntries.get(`penalty:${shipmentId}`)?.amountArs).toBe(PENALTY);
    });

    it("AC6: si la captura falla el envío queda cancelado y el barrido la reintenta sin duplicar", async () => {
      const shipmentId = await createAssigned();
      payments.behavior.captureError = new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "payments caído");

      const response = await cancel(shipmentId, { expectedPenaltyArs: PENALTY });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: ShipmentStatus.CANCELLED, cancellationPenaltyStatus: "pending" });
      expect(payments.holds.get(shipmentId)?.status).toBe("authorized");

      payments.behavior.captureError = null;
      // `graceMinutes` negativo: el barrido toma también lo recién cancelado.
      await app.settlements.retryPendingPenalties({ graceMinutes: -1, batchSize: 10 });

      expect((await shipmentRepo.findById(shipmentId))?.cancellationPenaltyStatus).toBe("captured");
      expect(payments.ledgerEntries.size).toBe(2);
      await app.settlements.retryPendingPenalties({ graceMinutes: -1, batchSize: 10 });
      expect(payments.captureHold).toHaveBeenCalledTimes(2);
    });

    it("AC4: un retiro que ya ocurrió gana y la cancelación da 409 sin cobrar nada", async () => {
      const shipmentId = await createAssigned(lateWindow(), ShipmentStatus.IN_TRANSIT);

      const response = await cancel(shipmentId, { expectedPenaltyArs: 0 });

      expect(response.statusCode).toBe(409);
      expect(payments.captureHold).not.toHaveBeenCalled();
      expect(payments.ledgerEntries.size).toBe(0);
    });

    it("updateStatus devuelve la penalidad que persistió, sin releer el envío", async () => {
      const shipmentId = await createAssigned();

      const cancelled = await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.CANCELLED, senderId, undefined, {
        expectedFrom: ShipmentStatus.ASSIGNED,
        cancellationPenaltyArs: PENALTY,
      });

      expect(cancelled).toMatchObject({ cancellationPenaltyArs: PENALTY, cancellationPenaltyStatus: "pending" });
      expect(await shipmentRepo.findById(shipmentId)).toMatchObject({
        cancellationPenaltyArs: PENALTY,
        cancellationPenaltyStatus: "pending",
      });
    });
  });
});
