import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { OfferStatus, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateOfferInput } from "../src/models/offer";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient, FakePaymentsClient } from "./fake-payments-client";
import { createFundingService, FundingConfig } from "../src/modules/funding/funding.service";
import { anchorTimeOfDayToInstant } from "../src/domain/pickup-window";
import { NotificationsClient } from "../src/adapters/notifications-client";
import { createShipmentsService } from "../src/modules/shipments/shipments.service";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CONFIG: FundingConfig = {
  nearPickupDays: 3,
  paymentTimeoutMinutes: 30,
  releaseHoursBeforePickup: 24,
  reminderIntervalHours: 12,
};

/** Día de calendario (`@db.Date`) a `days` días de hoy. */
function dateInDays(days: number): Date {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
}

describe("Saga de asignación: pago del emisor (MOVO-210, Postgres)", () => {
  let app: FastifyInstance;
  let offerRepo: OfferRepository;
  let shipmentRepo: ShipmentRepository;
  let notificationsClient: NotificationsClient;
  let paymentsClient: FakePaymentsClient;
  const senderId = randomUUID();
  const receiverId = randomUUID();

  function baseShipmentInput(pickupDate: Date): CreateShipmentInput {
    return {
      senderId,
      receiverId,
      packageType: PackageType.standard_package,
      weightKg: 2.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupLat: -31.4201,
      pickupLng: -64.1888,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: -31.4135,
      deliveryLng: -64.1811,
      pickupDate,
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 4500,
    };
  }

  function offerInput(shipmentId: string, pickupDate: Date, overrides: Partial<CreateOfferInput> = {}): CreateOfferInput {
    return { shipmentId, carrierId: randomUUID(), priceOffered: 5000, offeredDate: pickupDate, ...overrides };
  }

  async function createPublished(pickupDate: Date, overrides: Partial<CreateShipmentInput> = {}): Promise<string> {
    const created = await shipmentRepo.create({ ...baseShipmentInput(pickupDate), ...overrides });
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    const published = await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    return published.id;
  }

  async function accept(offerId: string) {
    return app.inject({ method: "POST", url: `/offers/${offerId}/accept`, headers: { "x-user-id": senderId } });
  }

  /** Envío publicado con retiro en `days` días + una oferta ganadora aceptada por HTTP. */
  async function acceptedShipment(days: number, shipmentOverrides: Partial<CreateShipmentInput> = {}) {
    const pickupDate = dateInDays(days);
    const shipmentId = await createPublished(pickupDate, shipmentOverrides);
    const winner = await offerRepo.create(offerInput(shipmentId, pickupDate));
    const loser = await offerRepo.create(offerInput(shipmentId, pickupDate, { priceOffered: 5500 }));
    const response = await accept(winner.id);
    expect(response.statusCode).toBe(200);
    return { shipmentId, winner, loser, pickupDate };
  }

  function buildService(overrides: { claim?: (key: string) => Promise<boolean> } = {}) {
    const claimed = new Set<string>();
    return createFundingService({
      repository: shipmentRepo,
      usersClient: createFakeUsersClient({}, {}, [], {}, { [senderId]: "emisor@movo.test" }),
      paymentsClient,
      notificationsClient,
      config: CONFIG,
      claimNotificationOnce:
        overrides.claim ??
        (async (key) => {
          if (claimed.has(key)) return false;
          claimed.add(key);
          return true;
        }),
    });
  }

  function pushedTitles(userId: string): string[] {
    return (notificationsClient.sendPush as ReturnType<typeof vi.fn>).mock.calls
      .map(([input]) => input as { userId: string; title: string })
      .filter((input) => input.userId === userId)
      .map((input) => input.title);
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    notificationsClient = createFakeNotificationsClient();
    paymentsClient = createFakePaymentsClient();
    app = buildApp({
      notificationsClient,
      paymentsClient,
      usersClient: createFakeUsersClient({}, {}, [], {}, { [senderId]: "emisor@movo.test" }),
      sweepEnabled: false,
      fundingSweepEnabled: false,
      pickupMissedSweepEnabled: false,
    });
    await app.ready();
    offerRepo = createOfferRepository(app.db);
    shipmentRepo = createShipmentRepository(app.db);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    paymentsClient.holds.clear();
    Object.assign(paymentsClient.behavior, createFakePaymentsClient().behavior);
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await app?.close();
  });

  describe("elección de ruta al aceptar (AC3/AC6)", () => {
    it("retiro cercano: assignment_pending y la ruta queda en shipment_events", async () => {
      const { shipmentId, winner, loser } = await acceptedShipment(1);

      const shipment = await shipmentRepo.findById(shipmentId);
      expect(shipment?.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
      expect(shipment?.carrierId).toBe(winner.carrierId);
      expect((await offerRepo.findById(winner.id))?.status).toBe(OfferStatus.ACCEPTED);
      expect((await offerRepo.findById(loser.id))?.status).toBe(OfferStatus.SUPERSEDED);

      const events = await shipmentRepo.listEvents(shipmentId);
      const accepted = events.find((e) => e.toStatus === ShipmentStatus.ASSIGNMENT_PENDING);
      expect(accepted?.reason).toContain("ruta cercana");
    });

    it("retiro lejano: assigned_unfunded con carrierId y precio, demás ofertas rechazadas, sin hold", async () => {
      const { shipmentId, winner, loser } = await acceptedShipment(10);

      const shipment = await shipmentRepo.findById(shipmentId);
      expect(shipment?.status).toBe(ShipmentStatus.ASSIGNED_UNFUNDED);
      expect(shipment?.carrierId).toBe(winner.carrierId);
      expect(shipment?.agreedPriceArs).toBe(winner.priceOffered);
      expect((await offerRepo.findById(loser.id))?.status).toBe(OfferStatus.SUPERSEDED);
      expect(paymentsClient.createHold).not.toHaveBeenCalled();

      const events = await shipmentRepo.listEvents(shipmentId);
      expect(events.find((e) => e.toStatus === ShipmentStatus.ASSIGNED_UNFUNDED)?.reason).toContain("ruta lejana");
    });
  });

  describe("GET/POST /shipments/:id/funding, ruta cercana (AC1/AC2/AC4/AC14)", () => {
    it("GET devuelve public_key del transportista, monto y plazo; solo el emisor", async () => {
      const { shipmentId, winner } = await acceptedShipment(1);

      const response = await app.inject({
        method: "GET",
        url: `/shipments/${shipmentId}/funding`,
        headers: { "x-user-id": senderId },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        shipmentId,
        route: "near",
        carrierPublicKey: "TEST-carrier-public-key",
        amountArs: winner.priceOffered,
      });
      expect(new Date(response.json().payUntil).getTime()).toBeGreaterThan(Date.now());
      expect(paymentsClient.getCheckoutData).toHaveBeenCalledWith(
        expect.objectContaining({ payerEmail: "emisor@movo.test", carrierId: winner.carrierId }),
      );

      const forbidden = await app.inject({
        method: "GET",
        url: `/shipments/${shipmentId}/funding`,
        headers: { "x-user-id": receiverId },
      });
      expect(forbidden.statusCode).toBe(403);
    });

    it("GET responde 409 si el envío no espera un pago (published)", async () => {
      const shipmentId = await createPublished(dateInDays(1));
      const response = await app.inject({
        method: "GET",
        url: `/shipments/${shipmentId}/funding`,
        headers: { "x-user-id": senderId },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_FUNDING_NOT_AVAILABLE");
    });

    it("POST con hold autorizado: assignment_pending -> assigned y push a ambas partes", async () => {
      const { shipmentId, winner } = await acceptedShipment(1);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/funding`,
        headers: { "x-user-id": senderId },
        payload: { cardToken: "tok_123", paymentMethodId: "visa" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ funded: true, shipmentStatus: ShipmentStatus.ASSIGNED });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED);
      expect((await offerRepo.findById(winner.id))?.status).toBe(OfferStatus.ACCEPTED);
      expect(paymentsClient.createHold).toHaveBeenCalledWith(
        expect.objectContaining({ cardToken: "tok_123", paymentMethodId: "visa", amountArs: winner.priceOffered }),
      );
      await vi.waitFor(() => {
        expect(pushedTitles(senderId)).toContain("Pago confirmado");
        expect(pushedTitles(winner.carrierId)).toContain("Envío confirmado");
      });
    });

    it("AC14: un segundo POST (doble tap) no crea otro hold y devuelve funded: true", async () => {
      const { shipmentId } = await acceptedShipment(1);
      const call = () =>
        app.inject({
          method: "POST",
          url: `/shipments/${shipmentId}/funding`,
          headers: { "x-user-id": senderId },
          payload: { cardToken: "tok_123" },
        });

      const first = await call();
      const second = await call();

      expect(first.json().funded).toBe(true);
      expect(second.statusCode).toBe(200);
      expect(second.json().funded).toBe(true);
      expect(paymentsClient.createHold).toHaveBeenCalledTimes(1);
      const events = await shipmentRepo.listEvents(shipmentId);
      expect(events.filter((e) => e.toStatus === ShipmentStatus.ASSIGNED)).toHaveLength(1);
    });

    it("AC14: dos POST simultáneos resuelven en una sola asignación", async () => {
      const { shipmentId } = await acceptedShipment(1);
      const call = () =>
        app.inject({
          method: "POST",
          url: `/shipments/${shipmentId}/funding`,
          headers: { "x-user-id": senderId },
          payload: { cardToken: "tok_123" },
        });

      const [a, b] = await Promise.all([call(), call()]);

      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      expect(a.json().funded && b.json().funded).toBe(true);
      const events = await shipmentRepo.listEvents(shipmentId);
      expect(events.filter((e) => e.toStatus === ShipmentStatus.ASSIGNED)).toHaveLength(1);
      expect(paymentsClient.holds.size).toBe(1);
    });

    it("un rechazo de la tarjeta no cambia el estado, devuelve el motivo y permite reintentar", async () => {
      const { shipmentId } = await acceptedShipment(1);
      paymentsClient.behavior.nextHoldStatus = "rejected";
      paymentsClient.behavior.nextFailureReason = "insufficient_funds";

      const rejected = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/funding`,
        headers: { "x-user-id": senderId },
        payload: { cardToken: "tok_bad" },
      });

      expect(rejected.statusCode).toBe(200);
      expect(rejected.json()).toMatchObject({
        funded: false,
        failureReason: "insufficient_funds",
        shipmentStatus: ShipmentStatus.ASSIGNMENT_PENDING,
      });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);

      paymentsClient.behavior.nextHoldStatus = "authorized";
      const retried = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/funding`,
        headers: { "x-user-id": senderId },
        payload: { cardToken: "tok_good" },
      });
      expect(retried.json().funded).toBe(true);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED);
    });

    it("si payments falla al crear el hold, el estado no cambia (502 reintentable)", async () => {
      const { shipmentId } = await acceptedShipment(1);
      paymentsClient.behavior.createFails = true;

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/funding`,
        headers: { "x-user-id": senderId },
        payload: { cardToken: "tok" },
      });

      expect(response.statusCode).toBe(502);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
    });

    it("un envío con el plazo vencido ya no se puede pagar (409)", async () => {
      const { shipmentId } = await acceptedShipment(1);
      const service = buildService();

      await expect(
        service.getFunding(shipmentId, senderId, new Date(Date.now() + 31 * 60 * 1000)),
      ).rejects.toMatchObject({ code: "SHIPMENT_FUNDING_NOT_AVAILABLE" });
    });
  });

  describe("timeout del pago, ruta cercana (AC5)", () => {
    it("pasado el plazo vuelve a published: sin transportista, oferta no aceptada, hold liberado y aviso a ambos", async () => {
      const { shipmentId, winner } = await acceptedShipment(1);
      // Hold colgado (MP no respondió todavía).
      paymentsClient.behavior.nextHoldStatus = "creating";
      await paymentsClient.createHold({
        shipmentId,
        carrierId: winner.carrierId,
        cardToken: "tok",
        amountArs: 5000,
        payerEmail: "e@x.test",
      });
      const service = buildService();

      const result = await service.expireUnpaidAssignmentPending(new Date(Date.now() + 31 * 60 * 1000));

      expect(result.revertedCount).toBe(1);
      const shipment = await shipmentRepo.findById(shipmentId);
      expect(shipment?.status).toBe(ShipmentStatus.PUBLISHED);
      expect(shipment?.carrierId).toBeNull();
      expect(shipment?.agreedPriceArs).toBeNull();
      expect((await offerRepo.findById(winner.id))?.status).not.toBe(OfferStatus.ACCEPTED);
      expect(paymentsClient.releaseHold).toHaveBeenCalledWith(shipmentId);
      expect(paymentsClient.holds.get(shipmentId)?.status).toBe("cancelled");
      const events = await shipmentRepo.listEvents(shipmentId);
      expect(events.at(-1)).toMatchObject({ toStatus: ShipmentStatus.PUBLISHED });
      expect(events.at(-1)?.reason).toContain("no completó el pago");
      expect(pushedTitles(senderId)).toContain("No se completó el pago");
      expect(pushedTitles(winner.carrierId)).toContain("El envío no se confirmó");
    });

    it("dentro del plazo no toca nada", async () => {
      const { shipmentId } = await acceptedShipment(1);
      const service = buildService();

      const result = await service.expireUnpaidAssignmentPending(new Date(Date.now() + 10 * 60 * 1000));

      expect(result.revertedCount).toBe(0);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
    });

    it("es idempotente: una segunda corrida no encuentra nada que revertir ni vuelve a avisar", async () => {
      const { shipmentId } = await acceptedShipment(1);
      const service = buildService();
      const later = new Date(Date.now() + 31 * 60 * 1000);

      await service.expireUnpaidAssignmentPending(later);
      const calls = (notificationsClient.sendPush as ReturnType<typeof vi.fn>).mock.calls.length;
      const second = await service.expireUnpaidAssignmentPending(later);

      expect(second.revertedCount).toBe(0);
      expect((notificationsClient.sendPush as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.PUBLISHED);
    });

    it("si el hold ya estaba autorizado, reconcilia a assigned en vez de revertir", async () => {
      const { shipmentId, winner } = await acceptedShipment(1);
      await paymentsClient.createHold({
        shipmentId,
        carrierId: winner.carrierId,
        cardToken: "tok",
        amountArs: 5000,
        payerEmail: "e@x.test",
      });
      const service = buildService();

      const result = await service.expireUnpaidAssignmentPending(new Date(Date.now() + 31 * 60 * 1000));

      expect(result.fundedCount).toBe(1);
      expect(result.revertedCount).toBe(0);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED);
    });

    it("si no se puede consultar el hold, no revierte a ciegas: reintenta en el próximo barrido", async () => {
      const { shipmentId } = await acceptedShipment(1);
      paymentsClient.behavior.lookupFails = true;
      const service = buildService();

      const result = await service.expireUnpaidAssignmentPending(new Date(Date.now() + 31 * 60 * 1000));

      expect(result.revertedCount).toBe(0);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
    });
  });

  describe("ventana de confirmación, ruta lejana (AC7/AC8/AC9/AC10/AC11)", () => {
    async function farShipment() {
      const data = await acceptedShipment(10);
      const pickupStart = anchorTimeOfDayToInstant(data.pickupDate, new Date("1970-01-01T09:00:00.000Z"));
      return { ...data, pickupStart };
    }

    it("antes de abrirse la ventana el emisor no puede pagar", async () => {
      const { shipmentId, pickupStart } = await farShipment();
      const service = buildService();

      await expect(
        service.getFunding(shipmentId, senderId, new Date(pickupStart.getTime() - 5 * DAY)),
      ).rejects.toMatchObject({ code: "SHIPMENT_FUNDING_NOT_AVAILABLE" });
    });

    it("al abrirse: aviso al emisor y al transportista una sola vez; luego recordatorios por cubeta", async () => {
      const { shipmentId, winner, pickupStart } = await farShipment();
      const service = buildService();
      const opened = new Date(pickupStart.getTime() - 2.5 * DAY);

      const first = await service.processUnfundedAssignments(opened);
      expect(first.openedCount).toBe(1);
      expect(pushedTitles(senderId)).toContain("Confirmá el pago de tu envío");
      expect(pushedTitles(winner.carrierId)).toContain("Pago del emisor pendiente");

      // misma cubeta: sin avisos nuevos
      const again = await service.processUnfundedAssignments(opened);
      expect(again.openedCount).toBe(0);
      expect(again.remindedCount).toBe(0);

      // siguiente cubeta de 12h: recordatorio solo al emisor
      const later = await service.processUnfundedAssignments(new Date(opened.getTime() + 13 * HOUR));
      expect(later.remindedCount).toBe(1);
      expect(pushedTitles(senderId)).toContain("Todavía falta confirmar el pago");
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED_UNFUNDED);
    });

    it("pago dentro de la ventana: assigned_unfunded -> assigned", async () => {
      const { shipmentId, pickupStart } = await farShipment();
      const service = buildService();

      const result = await service.submitFunding(
        shipmentId,
        senderId,
        { cardToken: "tok" },
        new Date(pickupStart.getTime() - 2 * DAY),
      );

      expect(result).toMatchObject({ funded: true, shipmentStatus: ShipmentStatus.ASSIGNED });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED);
    });

    it("sin pago a T-24h: vuelve a published con motivo y aviso obligatorio a las dos partes", async () => {
      const { shipmentId, winner, pickupStart } = await farShipment();
      const service = buildService();

      const result = await service.processUnfundedAssignments(new Date(pickupStart.getTime() - 23 * HOUR));

      expect(result.revertedCount).toBe(1);
      const shipment = await shipmentRepo.findById(shipmentId);
      expect(shipment?.status).toBe(ShipmentStatus.PUBLISHED);
      expect(shipment?.carrierId).toBeNull();
      const events = await shipmentRepo.listEvents(shipmentId);
      expect(events.at(-1)?.reason).toContain("Sin pago a T-24h");
      expect(pushedTitles(senderId)).toContain("Tu envío volvió a publicarse");
      expect(pushedTitles(winner.carrierId)).toContain("Envío liberado");
      // idempotente
      const second = await service.processUnfundedAssignments(new Date(pickupStart.getTime() - 22 * HOUR));
      expect(second.revertedCount).toBe(0);
    });

    it("AC11: un assigned_unfunded no puede pasar a in_transit por ningún camino", async () => {
      const { shipmentId } = await farShipment();

      await expect(shipmentRepo.updateStatus(shipmentId, ShipmentStatus.IN_TRANSIT, null)).rejects.toMatchObject({
        name: "InvalidShipmentTransitionError",
      });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED_UNFUNDED);
    });

    it("AC11: si el sweep estuvo caído y ya pasó la hora del retiro, además de liberar loguea el error", async () => {
      const { shipmentId, pickupStart } = await farShipment();
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const service = createFundingService({
        repository: shipmentRepo,
        usersClient: createFakeUsersClient({}),
        paymentsClient,
        notificationsClient,
        config: CONFIG,
        logger,
      });

      await service.processUnfundedAssignments(new Date(pickupStart.getTime() + HOUR));

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: "funding_missed_pickup", shipmentId }),
        expect.any(String),
      );
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.PUBLISHED);
    });
  });

  describe("cancelación (AC12)", () => {
    it("cancelar un assignment_pending con hold lo libera y notifica al transportista asignado", async () => {
      const { shipmentId, winner } = await acceptedShipment(1);
      paymentsClient.behavior.nextHoldStatus = "in_process";
      await paymentsClient.createHold({
        shipmentId,
        carrierId: winner.carrierId,
        cardToken: "tok",
        amountArs: 5000,
        payerEmail: "e@x.test",
      });

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/cancel`,
        headers: { "x-user-id": senderId },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(paymentsClient.releaseHold).toHaveBeenCalledWith(shipmentId);
      expect(paymentsClient.holds.get(shipmentId)?.status).toBe("cancelled");
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.CANCELLED);
      expect(pushedTitles(winner.carrierId)).toContain("Tu oferta fue cancelada");
    });

    it("si no se puede confirmar la liberación, el envío NO se cancela", async () => {
      const { shipmentId } = await acceptedShipment(1);
      paymentsClient.behavior.releaseError = new (await import("@movo/shared")).ApiError(
        502,
        "PAYMENTS_SERVICE_UNAVAILABLE",
        "caído",
      );

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/cancel`,
        headers: { "x-user-id": senderId },
        payload: {},
      });

      expect(response.statusCode).toBe(502);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
    });

    it("cancelar un assigned_unfunded no llama a payments (no hay hold)", async () => {
      const { shipmentId } = await acceptedShipment(10);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/cancel`,
        headers: { "x-user-id": senderId },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(paymentsClient.releaseHold).not.toHaveBeenCalled();
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.CANCELLED);
    });
  });

  describe("retiro no realizado sobre un envío assigned (MOVO-258 + MOVO-210)", () => {
    it("el barrido cancela y LIBERA el hold (antes nada llegaba a assigned)", async () => {
      const { shipmentId } = await acceptedShipment(1);
      await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/funding`,
        headers: { "x-user-id": senderId },
        payload: { cardToken: "tok" },
      });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED);
      // El hold quedó vivo en payments; el barrido corre con el reloj pasado la ventana + gracia.
      const service = createShipmentsService(shipmentRepo, createFakeUsersClient({}), notificationsClient, undefined, {
        pickupMissedGraceHours: 24,
        paymentsClient,
      });
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(Date.now() + 5 * DAY) });
      try {
        await service.expireUnpickedAssignedShipments();
      } finally {
        vi.useRealTimers();
      }

      expect(paymentsClient.releaseHold).toHaveBeenCalledWith(shipmentId);
      expect(paymentsClient.holds.get(shipmentId)?.status).toBe("cancelled");
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.CANCELLED);
    });
  });

  describe("aviso interno de MP (AC13)", () => {
    async function pendingWithRejectedHold() {
      const data = await acceptedShipment(1);
      paymentsClient.behavior.nextHoldStatus = "rejected";
      const hold = await paymentsClient.createHold({
        shipmentId: data.shipmentId,
        carrierId: data.winner.carrierId,
        cardToken: "tok",
        amountArs: 5000,
        payerEmail: "e@x.test",
      });
      return { ...data, hold };
    }

    it("un hold cancelado/vencido por MP revierte un assignment_pending y avisa a ambos", async () => {
      const { shipmentId, winner, hold } = await pendingWithRejectedHold();

      const response = await app.inject({
        method: "POST",
        url: `/internal/shipments/${shipmentId}/hold-events`,
        payload: { holdId: hold.id, event: "expired" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ handled: true, outcome: "reverted_to_published" });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.PUBLISHED);
      expect(pushedTitles(senderId)).toContain("Se perdió la reserva del pago");
      expect(pushedTitles(winner.carrierId)).toContain("El envío volvió a publicarse");
    });

    it("un aviso repetido es idempotente", async () => {
      const { shipmentId, hold } = await pendingWithRejectedHold();
      const call = () =>
        app.inject({
          method: "POST",
          url: `/internal/shipments/${shipmentId}/hold-events`,
          payload: { holdId: hold.id, event: "cancelled" },
        });

      await call();
      const second = await call();

      expect(second.statusCode).toBe(200);
      expect(second.json().handled).toBe(false);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.PUBLISHED);
    });

    it("un aviso de un hold anterior (no el vigente) se ignora", async () => {
      const { shipmentId } = await pendingWithRejectedHold();

      const response = await app.inject({
        method: "POST",
        url: `/internal/shipments/${shipmentId}/hold-events`,
        payload: { holdId: randomUUID(), event: "cancelled" },
      });

      expect(response.json()).toEqual({ handled: false, outcome: "stale_hold" });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
    });

    it("un rechazo de tarjeta avisado por MP no pierde la asignación: el emisor reintenta", async () => {
      const { shipmentId, hold } = await pendingWithRejectedHold();

      const response = await app.inject({
        method: "POST",
        url: `/internal/shipments/${shipmentId}/hold-events`,
        payload: { holdId: hold.id, event: "rejected" },
      });

      expect(response.json()).toEqual({ handled: false, outcome: "rejected_retry_allowed" });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
    });
  });

  describe("reconfirmación: MP pierde el hold de un envío ya assigned (MOVO-210)", () => {
    /** Envío pagado (`assigned`) cuyo hold MP después canceló/venció. */
    async function assignedWithLostHold(days = 1, overrides: Partial<CreateShipmentInput> = {}) {
      const data = await acceptedShipment(days, overrides);
      // Reloj controlado: en la ruta lejana la ventana de pago todavía no abrió con la hora real.
      const pickupStart = anchorTimeOfDayToInstant(data.pickupDate, new Date("1970-01-01T09:00:00.000Z"));
      const payAt = days > 3 ? new Date(pickupStart.getTime() - 2 * DAY) : new Date();
      const paid = await buildService().submitFunding(data.shipmentId, senderId, { cardToken: "tok" }, payAt);
      expect(paid.funded).toBe(true);
      const hold = paymentsClient.holds.get(data.shipmentId)!;
      paymentsClient.holds.set(data.shipmentId, { ...hold, status: "cancelled" });
      return { ...data, hold };
    }

    function sendEvent(shipmentId: string, holdId: string, event = "expired") {
      return app.inject({
        method: "POST",
        url: `/internal/shipments/${shipmentId}/hold-events`,
        payload: { holdId, event },
      });
    }

    it("vuelve a assigned_unfunded (no se libera) y avisa al emisor con el copy de reconfirmación", async () => {
      const { shipmentId, winner, hold } = await assignedWithLostHold();
      vi.mocked(notificationsClient.sendPush).mockClear();

      const response = await sendEvent(shipmentId, hold.id);

      expect(response.json()).toEqual({ handled: true, outcome: "reconfirmation_requested" });
      const shipment = await shipmentRepo.findById(shipmentId);
      expect(shipment?.status).toBe(ShipmentStatus.ASSIGNED_UNFUNDED);
      expect(shipment?.carrierId).toBe(winner.carrierId);
      expect((await offerRepo.findById(winner.id))?.status).toBe(OfferStatus.ACCEPTED);
      const events = await shipmentRepo.listEvents(shipmentId);
      expect(events.at(-1)?.reason).toContain("reconfirmar el pago");

      expect(notificationsClient.sendPush).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: senderId,
          title: "La reserva de tu pago expiró",
          body: "Confirmá el pago de nuevo para asegurar tu envío.",
          category: "payments",
          data: { type: "shipment", shipmentId },
        }),
      );
      expect(pushedTitles(winner.carrierId)).toContain("Pago del emisor por reconfirmar");
    });

    it("un aviso repetido no vuelve a notificar ni revierte el envío", async () => {
      const { shipmentId, hold } = await assignedWithLostHold();
      await sendEvent(shipmentId, hold.id);
      const calls = vi.mocked(notificationsClient.sendPush).mock.calls.length;

      const again = await sendEvent(shipmentId, hold.id);

      expect(again.json()).toEqual({ handled: false, outcome: "awaiting_payment" });
      expect(vi.mocked(notificationsClient.sendPush).mock.calls.length).toBe(calls);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED_UNFUNDED);
    });

    it("el emisor puede reconfirmar: GET/POST /funding sobre assigned_unfunded vuelven a dejarlo assigned", async () => {
      const { shipmentId, hold } = await assignedWithLostHold();
      await sendEvent(shipmentId, hold.id);

      const info = await app.inject({
        method: "GET",
        url: `/shipments/${shipmentId}/funding`,
        headers: { "x-user-id": senderId },
      });
      expect(info.statusCode).toBe(200);
      expect(info.json().route).toBe("far");

      const paid = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/funding`,
        headers: { "x-user-id": senderId },
        payload: { cardToken: "tok2" },
      });
      expect(paid.json()).toMatchObject({ funded: true, shipmentStatus: ShipmentStatus.ASSIGNED });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED);
      // dos holds: el original cancelado y el de la reconfirmación
      expect(paymentsClient.createHold).toHaveBeenCalledTimes(2);
    });

    it("con el retiro a menos de 24h el emisor igual tiene el margen del timeout para pagar", async () => {
      // Retiro hoy, ventana desde las 00:00 (AR): T-24h ya pasó, el plazo de la ruta lejana está vencido.
      const { shipmentId, hold } = await assignedWithLostHold(0, {
        pickupTimeWindowStart: new Date("1970-01-01T00:00:00.000Z"),
        pickupTimeWindowEnd: new Date("1970-01-01T23:59:00.000Z"),
      });
      await sendEvent(shipmentId, hold.id);
      const service = buildService();

      const early = await service.processUnfundedAssignments(new Date(Date.now() + 10 * 60 * 1000));
      expect(early.revertedCount).toBe(0);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED_UNFUNDED);

      const late = await service.processUnfundedAssignments(new Date(Date.now() + 31 * 60 * 1000));
      expect(late.revertedCount).toBe(1);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.PUBLISHED);
    });

    it("no pagar la reconfirmación a T-24h lo devuelve a published con aviso a ambos", async () => {
      const { shipmentId, winner, pickupDate, hold } = await assignedWithLostHold(10);
      await sendEvent(shipmentId, hold.id);
      const pickupStart = anchorTimeOfDayToInstant(pickupDate, new Date("1970-01-01T09:00:00.000Z"));
      const service = buildService();

      const result = await service.processUnfundedAssignments(new Date(pickupStart.getTime() - 23 * HOUR));

      expect(result.revertedCount).toBe(1);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.PUBLISHED);
      expect(pushedTitles(senderId)).toContain("Tu envío volvió a publicarse");
      expect(pushedTitles(winner.carrierId)).toContain("Envío liberado");
    });
  });
});
