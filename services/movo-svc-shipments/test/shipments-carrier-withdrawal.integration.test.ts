import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ApiError, OfferStatus, ShipmentStatus, TripStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createTripRepository } from "../src/repositories/trip-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient, FakePaymentsClient } from "./fake-payments-client";

const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Precio base del envío (sugerido); el acordado es la contraoferta del transportista. */
const BASE_PRICE = 1000;
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

/** La ventana que pidió el emisor al crear el envío. */
const ORIGINAL_WINDOW = {
  pickupDate: new Date("2031-06-01T00:00:00.000Z"),
  pickupTimeWindowStart: new Date("1970-01-01T14:00:00.000Z"),
  pickupTimeWindowEnd: new Date("1970-01-01T18:00:00.000Z"),
};

const FAR_WINDOW = {
  pickupDate: new Date("2030-01-01T00:00:00.000Z"),
  pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
  pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
};

describe("baja del transportista de un envío asignado (Postgres) — MOVO-310", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let payments: FakePaymentsClient;
  const sendPush = vi.fn().mockResolvedValue(undefined);

  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();
  const otherCarrierId = randomUUID();

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
    ...ORIGINAL_WINDOW,
    suggestedPriceArs: BASE_PRICE,
  };

  interface Fixture {
    shipmentId: string;
    offerId: string;
    otherOfferId: string;
  }

  /**
   * Envío asignado a `carrierId` con la ventana acordada pisando la original (MOVO-258 D3), su oferta
   * aceptada y otra oferta de `otherCarrierId` (`pending` si la asignación espera el pago,
   * `superseded` desde `assigned`). Con `withHold` crea además el hold. Fixture: bypasea la máquina de estados.
   */
  async function createAssignment(
    status: ShipmentStatus = ShipmentStatus.ASSIGNED,
    window = lateWindow(),
    { withHold = status === ShipmentStatus.ASSIGNED, tripId }: { withHold?: boolean; tripId?: string } = {}
  ): Promise<Fixture> {
    const created = await shipmentRepo.create(baseShipmentInput);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await app.db.shipment.update({
      where: { id: created.id },
      data: {
        status,
        carrierId,
        agreedPriceArs: AGREED_PRICE,
        lastStatusChangedAt: new Date(),
        originalPickupDate: ORIGINAL_WINDOW.pickupDate,
        originalPickupTimeWindowStart: ORIGINAL_WINDOW.pickupTimeWindowStart,
        originalPickupTimeWindowEnd: ORIGINAL_WINDOW.pickupTimeWindowEnd,
        ...window,
      },
    });
    const offer = await app.db.offer.create({
      data: {
        shipmentId: created.id,
        carrierId,
        priceOffered: AGREED_PRICE,
        offeredDate: window.pickupDate,
        status: "accepted",
        carrierNameAtOffer: "Juan P.",
        tripId: tripId ?? null,
      },
    });
    const other = await app.db.offer.create({
      data: {
        shipmentId: created.id,
        carrierId: otherCarrierId,
        priceOffered: AGREED_PRICE + 100,
        offeredDate: window.pickupDate,
        status: status === ShipmentStatus.ASSIGNED ? "superseded" : "pending",
      },
    });
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
    return { shipmentId: created.id, offerId: offer.id, otherOfferId: other.id };
  }

  const withdraw = (shipmentId: string, payload: Record<string, unknown> = {}, userId = carrierId) =>
    app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/carrier-withdrawal`,
      headers: { "x-user-id": userId },
      payload,
    });

  const quote = (shipmentId: string, userId = carrierId) =>
    app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/carrier-withdrawal-quote`,
      headers: { "x-user-id": userId },
    });

  const offerRow = (id: string) => app.db.offer.findUniqueOrThrow({ where: { id } });

  const pushesTo = (userId: string) =>
    sendPush.mock.calls.filter(([input]) => input.userId === userId).map(([input]) => input as { title: string; body: string; data: Record<string, unknown> });

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
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments, shipments.trips RESTART IDENTITY CASCADE");
    sendPush.mockClear();
    payments.holds.clear();
    payments.ledgerEntries.clear();
    payments.behavior.ledgerError = null;
    payments.behavior.releaseError = null;
    vi.mocked(payments.releaseHold).mockClear();
    vi.mocked(payments.createLedgerEntry).mockClear();
  });

  describe("desde assigned con menos de 12 h", () => {
    it("republica, desasigna, libera el hold entero y registra la penalidad como deuda del transportista", async () => {
      const { shipmentId, offerId, otherOfferId } = await createAssignment();

      const quoted = await quote(shipmentId);
      expect(quoted.statusCode).toBe(200);
      expect(quoted.json()).toMatchObject({ penaltyArs: PENALTY, reason: "late_cancellation" });

      const response = await withdraw(shipmentId, { expectedPenaltyArs: PENALTY });

      expect(response.statusCode).toBe(200);
      // El emisor vuelve a ver el precio base (no el acordado) y se puede contraofertar sobre él.
      expect(response.json()).toMatchObject({
        status: ShipmentStatus.PUBLISHED,
        carrierId: null,
        agreedPriceArs: null,
        suggestedPriceArs: BASE_PRICE,
      });

      // AC2: misma desasignación que la saga, con la ventana original restaurada.
      const stored = await app.db.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
      expect(stored.pickupDate).toEqual(ORIGINAL_WINDOW.pickupDate);
      expect(stored.pickupTimeWindowStart).toEqual(ORIGINAL_WINDOW.pickupTimeWindowStart);
      expect(stored.originalPickupDate).toBeNull();
      expect(stored.cancellationPenaltyArs).toBeNull();
      expect(await offerRow(offerId)).toMatchObject({ status: OfferStatus.CARRIER_WITHDRAWN, withdrawalPenaltyStatus: "debt" });
      expect((await offerRow(offerId)).withdrawalPenaltyArs?.toNumber()).toBe(PENALTY);
      expect((await offerRow(otherOfferId)).status).toBe(OfferStatus.SUPERSEDED);

      // AC3: el emisor no paga nada.
      expect(payments.holds.get(shipmentId)?.status).toBe("cancelled");
      expect(payments.captureHold).not.toHaveBeenCalled();

      // AC4: deuda en la cuenta corriente del transportista, nada al emisor.
      expect(payments.ledgerEntries.size).toBe(1);
      expect(payments.ledgerEntries.get(`withdrawal_penalty:${offerId}`)).toMatchObject({
        userId: carrierId,
        type: "cancellation_penalty",
        roleAtOrigin: "carrier",
        amountArs: PENALTY,
        status: "pending",
        shipmentId,
      });

      // AC6: avisos a las dos partes.
      const [senderPush] = pushesTo(senderId);
      expect(senderPush.body).toContain("Juan P. se bajó del envío");
      expect(senderPush.body).toContain("cancelarlo sin cargo");
      const [carrierPush] = pushesTo(carrierId);
      expect(carrierPush.title).toBe("Registramos una penalidad");
      expect(carrierPush.data).toMatchObject({ type: "carrier_withdrawal_penalty", offerId });

      // El envío ya no es del transportista: no puede volver a bajarse.
      expect((await withdraw(shipmentId)).statusCode).toBe(403);
    });

    it("un monto distinto del vigente es 409 con el monto y no toca nada", async () => {
      const { shipmentId, offerId } = await createAssignment();

      const response = await withdraw(shipmentId);

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toMatchObject({ code: "CANCELLATION_PENALTY_MISMATCH", details: { penaltyArs: PENALTY } });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED);
      expect((await offerRow(offerId)).status).toBe(OfferStatus.ACCEPTED);
      expect(payments.holds.get(shipmentId)?.status).toBe("authorized");
    });

    it("si payments no responde la deuda queda pending y el barrido la registra una sola vez", async () => {
      const { shipmentId, offerId } = await createAssignment();
      payments.behavior.ledgerError = new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "payments caído");

      const response = await withdraw(shipmentId, { expectedPenaltyArs: PENALTY });

      expect(response.statusCode).toBe(200);
      expect((await offerRow(offerId)).withdrawalPenaltyStatus).toBe("pending");
      expect(pushesTo(carrierId)).toHaveLength(0);

      payments.behavior.ledgerError = null;
      // `graceMinutes` negativo: el barrido toma también lo recién dado de baja.
      await app.settlements.retryPendingWithdrawalPenalties({ graceMinutes: -1, batchSize: 10 });
      await app.settlements.retryPendingWithdrawalPenalties({ graceMinutes: -1, batchSize: 10 });

      expect((await offerRow(offerId)).withdrawalPenaltyStatus).toBe("debt");
      expect(payments.ledgerEntries.size).toBe(1);
      expect(pushesTo(carrierId).map((push) => push.title)).toEqual(["Registramos una penalidad"]);
    });
  });

  it("desde assigned con 12 h o más: sin cargo, libera el hold y no toca la cuenta corriente", async () => {
    const { shipmentId, offerId } = await createAssignment(ShipmentStatus.ASSIGNED, FAR_WINDOW);

    expect((await quote(shipmentId)).json()).toMatchObject({ penaltyArs: 0, reason: "before_free_deadline" });
    const response = await withdraw(shipmentId);

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe(ShipmentStatus.PUBLISHED);
    expect(await offerRow(offerId)).toMatchObject({ status: OfferStatus.CARRIER_WITHDRAWN, withdrawalPenaltyStatus: null });
    expect((await offerRow(offerId)).carrierWithdrawnAt).not.toBeNull();
    expect(payments.holds.get(shipmentId)?.status).toBe("cancelled");
    expect(payments.ledgerEntries.size).toBe(0);
    expect(pushesTo(carrierId)).toHaveLength(0);
    expect(pushesTo(senderId)).toHaveLength(1);
  });

  it.each([ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.ASSIGNED_UNFUNDED])(
    "desde %s con menos de 12 h: también es deuda del transportista, y las demás ofertas siguen vivas",
    async (status) => {
      const { shipmentId, offerId, otherOfferId } = await createAssignment(status, lateWindow(), { withHold: true });
      payments.holds.set(shipmentId, { ...payments.holds.get(shipmentId)!, status: "in_process" });

      expect((await quote(shipmentId)).json()).toMatchObject({ penaltyArs: PENALTY, reason: "late_cancellation" });
      const response = await withdraw(shipmentId, { expectedPenaltyArs: PENALTY });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: ShipmentStatus.PUBLISHED, carrierId: null, suggestedPriceArs: BASE_PRICE });
      expect(await offerRow(offerId)).toMatchObject({ status: OfferStatus.CARRIER_WITHDRAWN, withdrawalPenaltyStatus: "debt" });
      expect((await offerRow(otherOfferId)).status).toBe(OfferStatus.PENDING);
      expect(payments.releaseHold).toHaveBeenCalledWith(shipmentId);
      expect(payments.ledgerEntries.get(`withdrawal_penalty:${offerId}`)).toMatchObject({ userId: carrierId, amountArs: PENALTY });
    }
  );

  it("con la ventana de retiro ya cerrada (antes del barrido de MOVO-258) también es deuda", async () => {
    const closedWindow = { ...FAR_WINDOW, pickupDate: new Date("2020-01-01T00:00:00.000Z") };
    const { shipmentId, offerId } = await createAssignment(ShipmentStatus.ASSIGNED, closedWindow);

    expect((await quote(shipmentId)).json()).toMatchObject({ penaltyArs: PENALTY, reason: "late_cancellation" });
    expect((await withdraw(shipmentId, { expectedPenaltyArs: PENALTY })).statusCode).toBe(200);
    expect((await offerRow(offerId)).withdrawalPenaltyStatus).toBe("debt");
    expect(payments.ledgerEntries.get(`withdrawal_penalty:${offerId}`)?.amountArs).toBe(PENALTY);
  });

  it("desde assignment_pending con 12 h o más: sin cargo", async () => {
    const { shipmentId, offerId } = await createAssignment(ShipmentStatus.ASSIGNMENT_PENDING, FAR_WINDOW, { withHold: false });

    expect((await withdraw(shipmentId)).statusCode).toBe(200);
    expect((await offerRow(offerId)).withdrawalPenaltyStatus).toBeNull();
    expect(payments.ledgerEntries.size).toBe(0);
  });

  it("solo el transportista asignado (403) y solo antes del retiro (409)", async () => {
    const { shipmentId } = await createAssignment();
    expect((await withdraw(shipmentId, {}, senderId)).statusCode).toBe(403);
    expect((await withdraw(shipmentId, {}, otherCarrierId)).statusCode).toBe(403);
    expect((await quote(shipmentId, senderId)).statusCode).toBe(403);

    const inTransit = await createAssignment(ShipmentStatus.IN_TRANSIT);
    const response = await withdraw(inTransit.shipmentId);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SHIPMENT_INVALID_TRANSITION");
    expect((await quote(inTransit.shipmentId)).statusCode).toBe(409);
  });

  describe("carreras", () => {
    it("con el handshake de retiro: gana uno solo y el estado queda consistente", async () => {
      const { shipmentId, offerId } = await createAssignment(ShipmentStatus.ASSIGNED, FAR_WINDOW);

      const [withdrawal, pickup] = await Promise.allSettled([
        withdraw(shipmentId),
        shipmentRepo.updateStatus(shipmentId, ShipmentStatus.IN_TRANSIT, carrierId, undefined, {
          expectedFrom: ShipmentStatus.ASSIGNED,
        }),
      ]);

      const withdrawalWon = withdrawal.status === "fulfilled" && withdrawal.value.statusCode === 200;
      expect(withdrawalWon).toBe(pickup.status === "rejected");
      const shipment = await shipmentRepo.findById(shipmentId);
      if (withdrawalWon) {
        expect(shipment?.status).toBe(ShipmentStatus.PUBLISHED);
        expect((await offerRow(offerId)).status).toBe(OfferStatus.CARRIER_WITHDRAWN);
        expect(payments.holds.get(shipmentId)?.status).toBe("cancelled");
      } else {
        expect(withdrawal.status === "fulfilled" && withdrawal.value.statusCode).toBe(409);
        expect(shipment).toMatchObject({ status: ShipmentStatus.IN_TRANSIT, carrierId });
        expect((await offerRow(offerId)).status).toBe(OfferStatus.ACCEPTED);
        expect(payments.holds.get(shipmentId)?.status).toBe("authorized");
      }
    });

    it("con el pago del emisor: si el hold se confirmó antes, la baja da 409 sin liberar nada", async () => {
      const { shipmentId, offerId } = await createAssignment(ShipmentStatus.ASSIGNMENT_PENDING, FAR_WINDOW, {
        withHold: true,
      });

      const [withdrawal, funding] = await Promise.allSettled([
        withdraw(shipmentId),
        shipmentRepo.updateStatus(shipmentId, ShipmentStatus.ASSIGNED, senderId, undefined, {
          expectedFrom: ShipmentStatus.ASSIGNMENT_PENDING,
          expectedCarrierId: carrierId,
          expectedAgreedPriceArs: AGREED_PRICE,
        }),
      ]);

      const withdrawalWon = withdrawal.status === "fulfilled" && withdrawal.value.statusCode === 200;
      expect(withdrawalWon).toBe(funding.status === "rejected");
      const shipment = await shipmentRepo.findById(shipmentId);
      if (withdrawalWon) {
        expect(shipment).toMatchObject({ status: ShipmentStatus.PUBLISHED, carrierId: null });
        expect(payments.releaseHold).toHaveBeenCalledWith(shipmentId);
      } else {
        expect(withdrawal.status === "fulfilled" && withdrawal.value.statusCode).toBe(409);
        expect(shipment).toMatchObject({ status: ShipmentStatus.ASSIGNED, carrierId });
        expect((await offerRow(offerId)).status).toBe(OfferStatus.ACCEPTED);
        expect(payments.releaseHold).not.toHaveBeenCalled();
      }
    });
  });

  it("AC7: si era el último paquete de un viaje activo, el barrido de MOVO-258 lo vence", async () => {
    const trip = await app.db.trip.create({
      data: {
        carrierId,
        originAddress: "Av. Colón 1234, Córdoba",
        originLat: -31.4201,
        originLng: -64.1888,
        destinationAddress: "Av. San Martín 100, Villa María",
        destinationLat: -32.4104,
        destinationLng: -63.2404,
        departureAt: new Date(),
        vehicleType: "auto",
        status: "active",
      },
    });
    const { shipmentId } = await createAssignment(ShipmentStatus.ASSIGNED, FAR_WINDOW, { tripId: trip.id });
    const tripRepo = createTripRepository(app.db);
    expect(await tripRepo.expireActiveWithoutPackages(10)).toEqual([]);

    expect((await withdraw(shipmentId)).statusCode).toBe(200);

    expect(await tripRepo.expireActiveWithoutPackages(10)).toEqual([trip.id]);
    expect((await app.db.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe(TripStatus.EXPIRED);
  });

  it("assigned -> published sin la baja del transportista se rechaza", async () => {
    const { shipmentId } = await createAssignment();

    await expect(shipmentRepo.updateStatus(shipmentId, ShipmentStatus.PUBLISHED, null)).rejects.toThrow(/carrierWithdrawal/);
    expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNED);
  });
});
