import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import {
  ApiError,
  OfferStatus,
  PaymentMethod,
  ShipmentStatus,
  cashPenaltyCompensationArs,
  decomposeOfferGrossPrice,
} from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { createFakePaymentsClient, FakePaymentsClient } from "./fake-payments-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { createFakePricingClient } from "./fake-pricing-client";
import { NotificationsClient } from "../src/adapters/notifications-client";

const PICKUP_DATE = new Date("2030-01-01T00:00:00.000Z");
const PICKUP_DATE_STR = "2030-01-01";
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Default de `CASH_SHIPMENT_MAX_CARRIER_DEBT_ARS`. */
const DEBT_LIMIT = 30000;

/** Retiro dentro de 1 h, con la ventana abierta hasta el fin del día: cancelar ahí cobra el 25 %. */
function lateWindow() {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const wallStart = new Date(start.getTime() - AR_OFFSET_MS);
  return {
    pickupDate: new Date(Date.UTC(wallStart.getUTCFullYear(), wallStart.getUTCMonth(), wallStart.getUTCDate())),
    pickupTimeWindowStart: new Date(
      Date.UTC(1970, 0, 1, wallStart.getUTCHours(), wallStart.getUTCMinutes(), wallStart.getUTCSeconds())
    ),
    pickupTimeWindowEnd: new Date("1970-01-01T23:59:59.000Z"),
  };
}

/**
 * MOVO-37: envíos pagados en efectivo, de punta a punta por HTTP contra Postgres y Redis reales (payments es el
 * fake en memoria, con el mismo cálculo de comisión y compensación que el real).
 */
describe("Envíos en efectivo (Postgres, MOVO-37)", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;
  let payments: FakePaymentsClient;
  let notificationsClient: NotificationsClient;

  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();
  const otherCarrierId = randomUUID();

  const profiles = Object.fromEntries(
    [senderId, receiverId, carrierId, otherCarrierId].map((id) => [id, fakePublicProfile({ id, isVerified: true })])
  );

  const createBody = {
    packageType: "standard_package",
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    receiverId,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.1811,
    pickupDate: PICKUP_DATE_STR,
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
  };

  function shipmentInput(overrides: Partial<CreateShipmentInput> = {}): CreateShipmentInput {
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
      pickupDate: PICKUP_DATE,
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 4500,
      ...overrides,
    };
  }

  async function createPublished(overrides: Partial<CreateShipmentInput> = {}) {
    const created = await shipmentRepo.create(shipmentInput({ paymentMethod: PaymentMethod.CASH, ...overrides }));
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    return shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, senderId);
  }

  const createShipment = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/shipments", headers: { "x-user-id": senderId }, payload: { ...createBody, ...payload } });

  const createOffer = (shipmentId: string, carrier = carrierId, priceOfferedArs = 5000) =>
    app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": carrier, "x-user-roles": "carrier" },
      payload: { priceOfferedArs, offeredDate: PICKUP_DATE_STR },
    });

  const accept = (offerId: string) =>
    app.inject({ method: "POST", url: `/offers/${offerId}/accept`, headers: { "x-user-id": senderId } });

  const changePaymentMethod = (shipmentId: string, paymentMethod: string, userId = senderId) =>
    app.inject({
      method: "PUT",
      url: `/shipments/${shipmentId}/payment-method`,
      headers: { "x-user-id": userId },
      payload: { paymentMethod },
    });

  const pushes = (userId: string) =>
    vi
      .mocked(notificationsClient.sendPush)
      .mock.calls.map(([input]) => input)
      .filter((input) => input.userId === userId);

  /** Envío en efectivo `assigned` con su oferta aceptada (fixture: bypasea la máquina de estados). */
  async function assignedCash(window: ReturnType<typeof lateWindow>, price = 10000): Promise<string> {
    const created = await shipmentRepo.create(shipmentInput({ paymentMethod: PaymentMethod.CASH }));
    // Republicarlo (baja del transportista) exige las fotos de creación.
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await app.db.shipment.update({
      where: { id: created.id },
      data: { status: ShipmentStatus.ASSIGNED, carrierId, agreedPriceArs: price, lastStatusChangedAt: new Date(), ...window },
    });
    await app.db.offer.create({
      data: { shipmentId: created.id, carrierId, priceOffered: price, offeredDate: window.pickupDate, status: "accepted" },
    });
    return created.id;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    payments = createFakePaymentsClient();
    notificationsClient = createFakeNotificationsClient();
    app = buildApp({
      usersClient: createFakeUsersClient(profiles),
      paymentsClient: payments,
      notificationsClient,
      pricingClient: createFakePricingClient(),
      sweepEnabled: false,
      fundingSweepEnabled: false,
      pickupMissedSweepEnabled: false,
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
    offerRepo = createOfferRepository(app.db);
  });

  afterAll(async () => {
    // Un envío `completed` que quede en la base rompe `migration-reversibility`.
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    vi.clearAllMocks();
    payments.holds.clear();
    payments.ledgerEntries.clear();
    Object.assign(payments.behavior, createFakePaymentsClient().behavior);
  });

  describe("B1: modalidad al crear el envío", () => {
    it("crea un envío en efectivo y por defecto es con tarjeta", async () => {
      const cash = await createShipment({ paymentMethod: "cash" });
      expect(cash.statusCode).toBe(201);
      expect(cash.json().paymentMethod).toBe("cash");

      const card = await createShipment({});
      expect(card.statusCode).toBe(201);
      expect(card.json().paymentMethod).toBe("card");
    });

    it("con deuda en la cuenta corriente el emisor no puede crear un envío en efectivo (403), con tarjeta sí", async () => {
      payments.behavior.pendingDebtByUserId.set(senderId, 150);

      const cash = await createShipment({ paymentMethod: "cash" });
      expect(cash.statusCode).toBe(403);
      expect(cash.json().error).toMatchObject({
        code: "CASH_PAYMENT_SENDER_HAS_DEBT",
        details: { missingRequirements: ["no_pending_debt"] },
      });
      expect(await app.db.shipment.count({ where: { senderId } })).toBe(0);

      const card = await createShipment({ paymentMethod: "card" });
      expect(card.statusCode).toBe(201);
    });

    it("falla cerrado si payments no responde", async () => {
      vi.mocked(payments.getUserDebtStatus).mockRejectedValueOnce(
        new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "caído")
      );

      const response = await createShipment({ paymentMethod: "cash" });
      expect(response.statusCode).toBe(502);
      expect(await app.db.shipment.count({ where: { senderId } })).toBe(0);
    });

    it("rechaza una modalidad desconocida", async () => {
      expect((await createShipment({ paymentMethod: "crypto" })).statusCode).toBe(400);
    });

    it("se puede cambiar antes de recibir ofertas y no después (409)", async () => {
      const shipment = await createPublished({ paymentMethod: PaymentMethod.CARD });

      const toCash = await changePaymentMethod(shipment.id, "cash");
      expect(toCash.statusCode).toBe(200);
      expect(toCash.json().paymentMethod).toBe("cash");

      expect((await createOffer(shipment.id)).statusCode).toBe(201);

      const locked = await changePaymentMethod(shipment.id, "card");
      expect(locked.statusCode).toBe(409);
      expect(locked.json().error.code).toBe("SHIPMENT_PAYMENT_METHOD_LOCKED");
      expect((await shipmentRepo.findById(shipment.id))?.paymentMethod).toBe(PaymentMethod.CASH);
    });

    it("pasar a efectivo exige no tener deuda, y solo lo cambia el emisor", async () => {
      const shipment = await createPublished({ paymentMethod: PaymentMethod.CARD });
      expect((await changePaymentMethod(shipment.id, "cash", receiverId)).statusCode).toBe(403);

      payments.behavior.pendingDebtByUserId.set(senderId, 10);
      const response = await changePaymentMethod(shipment.id, "cash");
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("CASH_PAYMENT_SENDER_HAS_DEBT");
    });
  });

  describe("B2: el transportista ve la modalidad antes de ofertar", () => {
    it("en el feed, en el detalle y en sus ofertas, sin descuento por deuda en efectivo", async () => {
      payments.behavior.pendingDebtByUserId.set(carrierId, 500);
      const shipment = await createPublished();

      const feed = await app.inject({
        method: "GET",
        url: "/shipments/available?originLat=-31.42&originLng=-64.19",
        headers: { "x-user-id": carrierId, "x-user-roles": "carrier" },
      });
      expect(feed.statusCode).toBe(200);
      const item = feed.json().items.find((i: { id: string }) => i.id === shipment.id);
      expect(item.paymentMethod).toBe("cash");
      // MOVO-311: el descuento por deuda sale del cobro con tarjeta; en efectivo no hay de dónde.
      expect(item.debtDiscount).toBeNull();

      const detail = await app.inject({
        method: "GET",
        url: `/shipments/${shipment.id}`,
        headers: { "x-user-id": carrierId, "x-user-roles": "carrier" },
      });
      expect(detail.json().paymentMethod).toBe("cash");

      expect((await createOffer(shipment.id)).statusCode).toBe(201);
      const mine = await app.inject({
        method: "GET",
        url: "/offers/mine",
        headers: { "x-user-id": carrierId, "x-user-roles": "carrier" },
      });
      expect(mine.json().items[0].shipment.paymentMethod).toBe("cash");
      expect(mine.json().items[0].debtDiscount).toBeNull();
    });
  });

  describe("B3: asignación sin saga", () => {
    it("al aceptar pasa directo a assigned, sin hold, y cierra las demás ofertas con aviso", async () => {
      const shipment = await createPublished();
      const winner = (await createOffer(shipment.id, carrierId)).json();
      const loser = (await createOffer(shipment.id, otherCarrierId, 5500)).json();

      const response = await accept(winner.id);

      expect(response.statusCode).toBe(200);
      expect(response.json().assignment).toEqual({
        shipmentStatus: "assigned",
        fundingRoute: null,
        fundingWindowOpensAt: null,
      });
      const assigned = await shipmentRepo.findById(shipment.id);
      expect(assigned).toMatchObject({ status: ShipmentStatus.ASSIGNED, carrierId });
      expect(assigned?.agreedPriceArs).toBeGreaterThan(0);
      expect((await offerRepo.findById(loser.id))?.status).toBe(OfferStatus.SUPERSEDED);
      expect(payments.createHold).not.toHaveBeenCalled();
      expect(payments.getCheckoutData).not.toHaveBeenCalled();
      expect(pushes(otherCarrierId).map((push) => push.data?.type)).toContain("offer_superseded");

      const events = await shipmentRepo.listEvents(shipment.id);
      expect(events.at(-1)).toMatchObject({ fromStatus: ShipmentStatus.PUBLISHED, toStatus: ShipmentStatus.ASSIGNED });
    });

    it("el detalle del emisor no muestra reserva de fondos", async () => {
      const shipment = await createPublished();
      const winner = (await createOffer(shipment.id)).json();
      await accept(winner.id);

      const detail = await app.inject({ method: "GET", url: `/shipments/${shipment.id}`, headers: { "x-user-id": senderId } });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().paymentMethod).toBe("cash");
      expect(detail.json().funding ?? null).toBeNull();
    });
  });

  describe("B4: tope de deuda del transportista", () => {
    it("con la deuda por encima del tope no puede ofertar en efectivo (403), en tarjeta sí", async () => {
      payments.behavior.pendingDebtByUserId.set(carrierId, DEBT_LIMIT + 0.01);
      const cash = await createPublished();
      const card = await createPublished({ paymentMethod: PaymentMethod.CARD });

      const rejected = await createOffer(cash.id);
      expect(rejected.statusCode).toBe(403);
      expect(rejected.json().error).toMatchObject({
        code: "CASH_DEBT_LIMIT_EXCEEDED",
        details: { missingRequirements: ["cash_debt_within_limit"] },
      });
      expect(await app.db.offer.count({ where: { shipmentId: cash.id } })).toBe(0);

      expect((await createOffer(card.id)).statusCode).toBe(201);
    });

    it("con la deuda justo en el tope todavía puede", async () => {
      payments.behavior.pendingDebtByUserId.set(carrierId, DEBT_LIMIT);
      const cash = await createPublished();

      expect((await createOffer(cash.id)).statusCode).toBe(201);
    });

    it("no se le puede aceptar una oferta si superó el tope después de ofertar (409, sin details)", async () => {
      const shipment = await createPublished();
      const offer = (await createOffer(shipment.id)).json();
      payments.behavior.pendingDebtByUserId.set(carrierId, DEBT_LIMIT + 1000);

      const response = await accept(offer.id);

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("OFFER_CARRIER_NOT_ELIGIBLE");
      expect(response.json().error.details).toBeUndefined();
      expect((await shipmentRepo.findById(shipment.id))?.status).toBe(ShipmentStatus.PUBLISHED);
      expect((await offerRepo.findById(offer.id))?.status).toBe(OfferStatus.PENDING);
    });

    it("tampoco puede editar la oferta", async () => {
      const shipment = await createPublished();
      const offer = (await createOffer(shipment.id)).json();
      payments.behavior.pendingDebtByUserId.set(carrierId, DEBT_LIMIT + 1);

      const response = await app.inject({
        method: "PATCH",
        url: `/offers/${offer.id}`,
        headers: { "x-user-id": carrierId, "x-user-roles": "carrier" },
        payload: { priceOfferedArs: 4800 },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("CASH_DEBT_LIMIT_EXCEEDED");
    });
  });

  describe("B6/B8: comisión al confirmarse la entrega", () => {
    it("registra la comisión como deuda del transportista, completa el envío y avisa sin monto", async () => {
      const shipmentId = await assignedCash(lateWindow(), 11500);
      await app.db.shipment.update({ where: { id: shipmentId }, data: { status: ShipmentStatus.DELIVERED, deliveredAt: new Date() } });

      expect(await app.settlements.captureAndComplete(shipmentId)).toBe("completed");

      expect(payments.captureHold).not.toHaveBeenCalled();
      expect(payments.registerCashCommission).toHaveBeenCalledWith(shipmentId, { senderId, carrierId, agreedPriceArs: 11500 });
      expect(payments.ledgerEntries.get(`cash_commission:${shipmentId}`)).toMatchObject({
        userId: carrierId,
        type: "cash_commission",
        amountArs: decomposeOfferGrossPrice(11500).commissionAmountArs,
      });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.COMPLETED);
      const push = pushes(carrierId).find((p) => p.data?.type === "cash_commission");
      expect(push).toMatchObject({ category: "payments", data: { shipmentId } });
      expect(push?.body).not.toMatch(/\$/);

      // Un reintento (barrido) no duplica la deuda ni el aviso.
      expect(await app.settlements.captureAndComplete(shipmentId)).toBe("already_completed");
      expect(payments.ledgerEntries.size).toBe(1);
      expect(pushes(carrierId).filter((p) => p.data?.type === "cash_commission")).toHaveLength(1);
    });

    it("si payments falla, el envío queda delivered para el barrido", async () => {
      const shipmentId = await assignedCash(lateWindow());
      await app.db.shipment.update({ where: { id: shipmentId }, data: { status: ShipmentStatus.DELIVERED, deliveredAt: new Date() } });
      payments.behavior.ledgerError = new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "caído");

      await expect(app.settlements.captureAndComplete(shipmentId)).rejects.toThrow();
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.DELIVERED);

      payments.behavior.ledgerError = null;
      expect(await app.settlements.captureAndComplete(shipmentId)).toBe("completed");
    });
  });

  describe("B7: cancelación tardía del emisor", () => {
    const cancel = (shipmentId: string, expectedPenaltyArs: number) =>
      app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/cancel`,
        headers: { "x-user-id": senderId },
        payload: { expectedPenaltyArs },
      });

    it("la penalidad va como deuda del emisor y se compensa al transportista, sin tocar holds", async () => {
      const shipmentId = await assignedCash(lateWindow(), 10000);

      const response = await cancel(shipmentId, 2500);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "cancelled",
        cancellationPenaltyArs: 2500,
        cancellationPenaltyStatus: "debt",
      });
      expect(payments.captureHold).not.toHaveBeenCalled();
      expect(payments.releaseHold).not.toHaveBeenCalled();
      expect(payments.findHoldByShipment).not.toHaveBeenCalled();
      expect(payments.ledgerEntries.get(`penalty:${shipmentId}`)).toMatchObject({
        userId: senderId,
        type: "cancellation_penalty",
        amountArs: 2500,
      });
      const compensation = cashPenaltyCompensationArs(10000, 2500);
      expect(payments.ledgerEntries.get(`penalty_compensation:${shipmentId}`)).toMatchObject({
        userId: carrierId,
        type: "cancellation_compensation",
        amountArs: -compensation,
      });
      expect(pushes(senderId).some((p) => p.title === "Tenés una penalidad pendiente")).toBe(true);
      const carrierPushes = pushes(carrierId);
      expect(carrierPushes.some((p) => p.title === "Recibiste una compensación")).toBe(true);
      // Ya recibió el aviso de la compensación: no además el de oferta cancelada.
      expect(carrierPushes).toHaveLength(1);
    });

    it("con 12 h o más se cancela sin cargo y sin llamar a payments", async () => {
      const shipmentId = await assignedCash({
        pickupDate: PICKUP_DATE,
        pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
        pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      });

      const response = await cancel(shipmentId, 0);

      expect(response.statusCode).toBe(200);
      expect(payments.registerCashCancellationPenalty).not.toHaveBeenCalled();
      expect(payments.releaseHold).not.toHaveBeenCalled();
    });

    it("si payments falla la penalidad queda pendiente y el reintento la registra una sola vez", async () => {
      const shipmentId = await assignedCash(lateWindow(), 10000);
      payments.behavior.ledgerError = new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "caído");

      const response = await cancel(shipmentId, 2500);
      expect(response.statusCode).toBe(200);
      expect(response.json().cancellationPenaltyStatus).toBe("pending");

      payments.behavior.ledgerError = null;
      expect(await app.settlements.settleCancellationPenalty(shipmentId)).toBe("debt");
      expect(await app.settlements.settleCancellationPenalty(shipmentId)).toBe("already_resolved");
      expect(payments.registerCashCancellationPenalty).toHaveBeenCalledTimes(2);
    });
  });

  describe("baja del transportista", () => {
    it("vuelve a publicarse sin consultar holds", async () => {
      const shipmentId = await assignedCash({
        pickupDate: PICKUP_DATE,
        pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
        pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      });

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/carrier-withdrawal`,
        headers: { "x-user-id": carrierId, "x-user-roles": "carrier" },
        payload: { expectedPenaltyArs: 0 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe("published");
      expect(payments.findHoldByShipment).not.toHaveBeenCalled();
      expect(payments.releaseHold).not.toHaveBeenCalled();
    });
  });
});
