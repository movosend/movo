import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ApiError, OfferStatus, ShipmentStatus, TripStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository } from "../src/repositories/offer-repository";
import { createPositionRepository, PositionRepository } from "../src/repositories/position-repository";
import { createPickupEvidenceRepository, PickupEvidenceRepository } from "../src/repositories/pickup-evidence-repository";
import { createShipmentsService } from "../src/modules/shipments/shipments.service";
import { PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient, FakePaymentsClient } from "./fake-payments-client";

const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const PICKUP = { lat: -31.4201, lng: -64.1888 };
const AGREED_PRICE = 1000;
const PENALTY = 250;
/** Ventana ya cerrada hace días (el barrido la toma con la gracia de 24 h). */
const PAST_WINDOW = {
  pickupDate: new Date("2026-08-20T00:00:00.000Z"),
  pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
  pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
};

/** Ventana con la forma de las columnas (`@db.Date` + `@db.Time`, reloj argentino) que contiene a `t`
 * (±20 min, sin cruzar la medianoche argentina). */
function windowAround(t: Date) {
  const wall = new Date(t.getTime() - AR_OFFSET_MS);
  const dayStart = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  const start = new Date(Math.max(wall.getTime() - 20 * MINUTE_MS, dayStart));
  const end = new Date(Math.min(wall.getTime() + 20 * MINUTE_MS, dayStart + 24 * HOUR_MS - 1000));
  const time = (d: Date) => new Date(Date.UTC(1970, 0, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  return { pickupDate: new Date(dayStart), pickupTimeWindowStart: time(start), pickupTimeWindowEnd: time(end) };
}

/** ~1 km por cada 0,009° de latitud. */
const metersNorth = (meters: number) => ({ lat: PICKUP.lat + meters / 111_195, lng: PICKUP.lng });

describe("atribución del no-retiro (Postgres, MOVO-270 / ADR-052)", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let positionRepo: PositionRepository;
  let evidenceRepo: PickupEvidenceRepository;
  let payments: FakePaymentsClient;
  const sendPush = vi.fn().mockResolvedValue(undefined);
  const carrierId = randomUUID();

  async function createTrip(status: TripStatus, startedAt: Date | null = null) {
    return app.db.trip.create({
      data: {
        carrierId,
        originAddress: "Av. Colón 1234, Córdoba",
        originLat: PICKUP.lat,
        originLng: PICKUP.lng,
        destinationAddress: "Av. San Martín 100, Villa María",
        destinationLat: -32.4104,
        destinationLng: -63.2404,
        departureAt: new Date(Date.now() - 2 * HOUR_MS),
        vehicleType: "auto",
        status,
        startedAt,
      },
    });
  }

  /** Envío del transportista en `status` con su oferta aceptada en `tripId` y, si está `assigned`, su hold.
   * Fixture: bypasea la máquina de estados (`lastStatusChangedAt` 3 h atrás). */
  async function createShipment(
    tripId: string,
    status: ShipmentStatus = ShipmentStatus.ASSIGNED,
    window: { pickupDate: Date; pickupTimeWindowStart: Date; pickupTimeWindowEnd: Date } = PAST_WINDOW
  ) {
    const created = await shipmentRepo.create({
      senderId: randomUUID(),
      receiverId: randomUUID(),
      packageType: PackageType.standard_package,
      weightKg: 2.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      description: "Caja",
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupLat: PICKUP.lat,
      pickupLng: PICKUP.lng,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: -31.4135,
      deliveryLng: -64.1811,
      ...window,
      suggestedPriceArs: AGREED_PRICE,
    });
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await app.db.shipment.update({
      where: { id: created.id },
      data: { status, carrierId, agreedPriceArs: AGREED_PRICE, lastStatusChangedAt: new Date(Date.now() - 3 * HOUR_MS) },
    });
    const offer = await app.db.offer.create({
      data: {
        shipmentId: created.id,
        carrierId,
        priceOffered: AGREED_PRICE,
        offeredDate: PAST_WINDOW.pickupDate,
        status: OfferStatus.ACCEPTED,
        tripId,
      },
    });
    if (status === ShipmentStatus.ASSIGNED) {
      await payments.createHold({
        shipmentId: created.id,
        carrierId,
        cardToken: "tok",
        amountArs: AGREED_PRICE,
        payerEmail: "emisor@example.com",
        payerUserId: created.senderId,
      });
    }
    return { shipmentId: created.id, offerId: offer.id, senderId: created.senderId };
  }

  const sweep = () =>
    createShipmentsService(shipmentRepo, createFakeUsersClient({}), { sendPush }, undefined, {
      offerRepository: createOfferRepository(app.db),
      paymentsClient: payments,
      pickupEvidenceRepository: evidenceRepo,
      registerWithdrawalPenalty: (offerId) => app.settlements.registerWithdrawalPenalty(offerId),
    }).expireUnpickedAssignedShipments();

  const lastEvent = (shipmentId: string) =>
    app.db.shipmentEvent.findFirstOrThrow({ where: { shipmentId }, orderBy: { createdAt: "desc" } });

  const report = (shipmentId: string, body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/shipments/${shipmentId}/positions`, headers: { "x-user-id": carrierId }, payload: body });

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    payments = createFakePaymentsClient();
    app = buildApp({
      usersClient: createFakeUsersClient({}),
      notificationsClient: { sendPush },
      paymentsClient: payments,
      pickupMissedSweepEnabled: false,
      tripExpirySweepEnabled: false,
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
    positionRepo = createPositionRepository(app.db);
    evidenceRepo = createPickupEvidenceRepository(app.db);
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
    vi.mocked(payments.releaseHold).mockClear();
  });

  describe("evidencia de llegada desde la ingesta (AC4-AC6)", () => {
    it("una posición dentro del radio registra la llegada una sola vez, con hora del dispositivo y precisión", async () => {
      const capturedAt = new Date(Date.now() - 5 * MINUTE_MS);
      const trip = await createTrip(TripStatus.ACTIVE, new Date(Date.now() - HOUR_MS));
      const { shipmentId } = await createShipment(trip.id, ShipmentStatus.ASSIGNED, windowAround(capturedAt));

      const first = await report(shipmentId, { ...metersNorth(100), accuracyM: 20, capturedAt: capturedAt.toISOString() });
      expect(first.statusCode).toBe(202);
      await vi.waitFor(async () => expect((await evidenceRepo.find(shipmentId, carrierId))?.arrivedAt).toEqual(capturedAt));

      // Otro tramo de 45 s, también dentro del radio: no pisa la primera llegada.
      const later = new Date(capturedAt.getTime() + 60_000);
      await report(shipmentId, { ...metersNorth(50), accuracyM: 5, capturedAt: later.toISOString() });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const rows = await app.db.pickupEvidence.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ arrivedAt: capturedAt });
      expect(rows[0].arrivedAccuracyM?.toNumber()).toBe(20);
      // AC2: antes del retiro no se guarda traza.
      expect(await app.db.carrierPosition.count()).toBe(0);
    });

    it("una posición simulada (mocked) dentro del radio no genera la llegada ni cuenta para la ausencia", async () => {
      const capturedAt = new Date(Date.now() - 5 * MINUTE_MS);
      const trip = await createTrip(TripStatus.ACTIVE, new Date(Date.now() - HOUR_MS));
      const { shipmentId } = await createShipment(trip.id, ShipmentStatus.ASSIGNED, windowAround(capturedAt));

      const response = await report(shipmentId, { ...metersNorth(10), accuracyM: 5, capturedAt: capturedAt.toISOString(), mocked: true });
      expect(response.statusCode).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(await evidenceRepo.find(shipmentId, carrierId)).toBeNull();
    });

    it("las posiciones lejanas y las de zona gris suman a su contador", async () => {
      const capturedAt = new Date(Date.now() - 10 * MINUTE_MS);
      const trip = await createTrip(TripStatus.ACTIVE, new Date(Date.now() - HOUR_MS));
      const { shipmentId } = await createShipment(trip.id, ShipmentStatus.ASSIGNED, windowAround(capturedAt));

      await report(shipmentId, { ...metersNorth(5000), accuracyM: 20, capturedAt: capturedAt.toISOString() });
      await report(shipmentId, { ...metersNorth(800), accuracyM: 20, capturedAt: new Date(capturedAt.getTime() + 60_000).toISOString() });

      await vi.waitFor(async () =>
        expect(await evidenceRepo.find(shipmentId, carrierId)).toEqual({ arrivedAt: null, farPositionsInWindow: 1, grayPositionsInWindow: 1 })
      );
    });
  });

  describe("barrido de retiro no realizado (AC8-AC12)", () => {
    it("AC8: viaje nunca iniciado -> cancela atribuido al transportista y le registra la penalidad una sola vez", async () => {
      const trip = await createTrip(TripStatus.DECLARED);
      const { shipmentId, offerId } = await createShipment(trip.id);

      expect(await sweep()).toEqual({ expiredCount: 1, disputedCount: 0, errorsCount: 0 });

      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.CANCELLED);
      expect(await lastEvent(shipmentId)).toMatchObject({ toStatus: ShipmentStatus.CANCELLED, attribution: "carrier", actorId: null });
      expect(payments.holds.get(shipmentId)?.status).toBe("cancelled");
      const offer = await app.db.offer.findUniqueOrThrow({ where: { id: offerId } });
      expect(offer).toMatchObject({ status: OfferStatus.SHIPMENT_CANCELLED, withdrawalPenaltyStatus: "debt" });
      expect(offer.withdrawalPenaltyArs?.toNumber()).toBe(PENALTY);

      // Idempotencia: otro barrido y el reintento de liquidaciones no vuelven a cobrar.
      await sweep();
      await app.settlements.retryPendingWithdrawalPenalties({ graceMinutes: -1, batchSize: 10 });
      expect(payments.ledgerEntries.size).toBe(1);
      expect([...payments.ledgerEntries.keys()]).toEqual([`withdrawal_penalty:${offerId}`]);
      const carrierPushes = sendPush.mock.calls.filter(([input]) => input.userId === carrierId).map(([input]) => input.title);
      expect(carrierPushes.sort()).toEqual(["Envío cancelado", "Registramos una penalidad"]);
    });

    it("AC8: si payments no responde, la penalidad queda pending y el barrido de liquidaciones la registra", async () => {
      const trip = await createTrip(TripStatus.DECLARED);
      const { offerId } = await createShipment(trip.id);
      payments.behavior.ledgerError = new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "caído");

      await sweep();
      expect((await app.db.offer.findUniqueOrThrow({ where: { id: offerId } })).withdrawalPenaltyStatus).toBe("pending");

      payments.behavior.ledgerError = null;
      await app.settlements.retryPendingWithdrawalPenalties({ graceMinutes: -1, batchSize: 10 });
      expect((await app.db.offer.findUniqueOrThrow({ where: { id: offerId } })).withdrawalPenaltyStatus).toBe("debt");
      expect(payments.ledgerEntries.size).toBe(1);
    });

    it("AC8: tres posiciones lejanas sin zona gris -> no llegó", async () => {
      const trip = await createTrip(TripStatus.ACTIVE, new Date("2026-08-20T11:00:00.000Z"));
      const { shipmentId } = await createShipment(trip.id);
      await app.db.pickupEvidence.create({ data: { shipmentId, carrierId, farPositionsInWindow: 3 } });

      await sweep();

      expect(await lastEvent(shipmentId)).toMatchObject({ toStatus: ShipmentStatus.CANCELLED, attribution: "carrier" });
    });

    it("AC9: llegó sin handshake -> disputa, hold liberado, sin cobro y sin bloquear al transportista", async () => {
      const trip = await createTrip(TripStatus.ACTIVE, new Date("2026-08-20T11:00:00.000Z"));
      const { shipmentId, offerId } = await createShipment(trip.id);
      await evidenceRepo.record(shipmentId, carrierId, "arrival", { arrivedAt: new Date("2026-08-20T13:30:00.000Z"), ...PICKUP, accuracyM: 15 });

      expect(await sweep()).toEqual({ expiredCount: 0, disputedCount: 1, errorsCount: 0 });

      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.DISPUTED);
      expect(await lastEvent(shipmentId)).toMatchObject({ fromStatus: ShipmentStatus.ASSIGNED, toStatus: ShipmentStatus.DISPUTED });
      expect(payments.holds.get(shipmentId)?.status).toBe("cancelled");
      expect((await app.db.offer.findUniqueOrThrow({ where: { id: offerId } })).withdrawalPenaltyStatus).toBeNull();
      expect(payments.ledgerEntries.size).toBe(0);
      expect(await shipmentRepo.hasOpenDisputeAsCarrier(carrierId)).toBe(false);
      expect(sendPush.mock.calls.map(([input]) => input.title)).toEqual(["Envío en disputa", "Envío en disputa", "Envío en disputa"]);
    });

    it("AC10: viaje activo sin posiciones -> sin evidencia, cancela sin culpables ni penalidad", async () => {
      const trip = await createTrip(TripStatus.ACTIVE, new Date("2026-08-20T11:00:00.000Z"));
      const { shipmentId, offerId } = await createShipment(trip.id);

      await sweep();

      expect(await lastEvent(shipmentId)).toMatchObject({ toStatus: ShipmentStatus.CANCELLED, attribution: "none" });
      expect((await app.db.offer.findUniqueOrThrow({ where: { id: offerId } })).withdrawalPenaltyStatus).toBeNull();
      expect(payments.ledgerEntries.size).toBe(0);
    });
  });

  describe("la evidencia es de la asignación vigente", () => {
    it("la llegada de un transportista que se bajó no la hereda el siguiente", async () => {
      const trip = await createTrip(TripStatus.ACTIVE, new Date("2026-08-20T11:00:00.000Z"));
      const { shipmentId } = await createShipment(trip.id);
      const arrival = { arrivedAt: new Date("2026-08-20T13:30:00.000Z"), ...PICKUP, accuracyM: 15 };
      await evidenceRepo.record(shipmentId, carrierId, "arrival", arrival);

      // Baja del transportista A: la fila se borra en la misma transacción.
      await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.PUBLISHED, carrierId, "se bajó", { expectedFrom: ShipmentStatus.ASSIGNED });
      expect(await app.db.pickupEvidence.count()).toBe(0);

      // Una escritura tardía de A, o la fila que quedó de A, no cuenta para B.
      const otherCarrierId = randomUUID();
      await app.db.pickupEvidence.create({ data: { shipmentId, carrierId, arrivedAt: arrival.arrivedAt } });
      expect(await evidenceRepo.find(shipmentId, otherCarrierId)).toBeNull();
      await evidenceRepo.record(shipmentId, otherCarrierId, "far", arrival);
      expect(await evidenceRepo.find(shipmentId, otherCarrierId)).toEqual({ arrivedAt: null, farPositionsInWindow: 1, grayPositionsInWindow: 0 });
    });
  });

  describe("cancelación del emisor con la ventana cerrada (AC13)", () => {
    it("con llegada registrada la cotización y la cancelación cobran la penalidad; sin llegada, sin cargo", async () => {
      // Ventana cerrada hace menos que la gracia del barrido: el emisor todavía puede cancelar.
      const closed = windowAround(new Date(Date.now() - 2 * HOUR_MS));
      const trip = await createTrip(TripStatus.ACTIVE, new Date(Date.now() - 4 * HOUR_MS));
      const arrived = await createShipment(trip.id, ShipmentStatus.ASSIGNED, closed);
      const notArrived = await createShipment(trip.id, ShipmentStatus.ASSIGNED, closed);
      await evidenceRepo.record(arrived.shipmentId, carrierId, "arrival", { arrivedAt: new Date(Date.now() - 2 * HOUR_MS), ...PICKUP, accuracyM: 10 });

      const quote = (shipmentId: string, senderId: string) =>
        app.inject({ method: "GET", url: `/shipments/${shipmentId}/cancellation-quote`, headers: { "x-user-id": senderId } });
      expect((await quote(arrived.shipmentId, arrived.senderId)).json()).toMatchObject({ penaltyArs: PENALTY, reason: "carrier_arrived" });
      expect((await quote(notArrived.shipmentId, notArrived.senderId)).json()).toMatchObject({ penaltyArs: 0, reason: "pickup_window_closed" });

      const cancel = (shipmentId: string, senderId: string, expectedPenaltyArs: number) =>
        app.inject({
          method: "POST",
          url: `/shipments/${shipmentId}/cancel`,
          headers: { "x-user-id": senderId },
          payload: { expectedPenaltyArs },
        });
      // Sin confirmar el monto nuevo no se cancela.
      expect((await cancel(arrived.shipmentId, arrived.senderId, 0)).json().error).toMatchObject({
        code: "CANCELLATION_PENALTY_MISMATCH",
        details: { penaltyArs: PENALTY },
      });
      expect((await cancel(arrived.shipmentId, arrived.senderId, PENALTY)).statusCode).toBe(200);
      const row = await app.db.shipment.findUniqueOrThrow({ where: { id: arrived.shipmentId } });
      expect(row.cancellationPenaltyArs?.toNumber()).toBe(PENALTY);
    });
  });

  describe("traza con custodia (AC1-AC3)", () => {
    it("la traza de un envío se lee por viaje y rango de custodia, aunque la fila sea de otro envío", async () => {
      const trip = await createTrip(TripStatus.ACTIVE, new Date(Date.now() - 3 * HOUR_MS));
      const a = await createShipment(trip.id, ShipmentStatus.IN_TRANSIT);
      const b = await createShipment(trip.id, ShipmentStatus.IN_TRANSIT);
      const base = Date.now();
      const t = (minutesAgo: number) => new Date(base - minutesAgo * MINUTE_MS);
      // `b` se retiró hace 60 min; `a` hace 120 min y se entregó hace 30.
      await app.db.shipmentEvent.createMany({
        data: [
          { shipmentId: a.shipmentId, fromStatus: ShipmentStatus.ASSIGNED, toStatus: ShipmentStatus.IN_TRANSIT, createdAt: t(120) },
          { shipmentId: a.shipmentId, fromStatus: ShipmentStatus.IN_TRANSIT, toStatus: ShipmentStatus.DELIVERED, createdAt: t(30) },
          { shipmentId: b.shipmentId, fromStatus: ShipmentStatus.ASSIGNED, toStatus: ShipmentStatus.IN_TRANSIT, createdAt: t(60) },
        ],
      });
      // Todas las filas quedaron asociadas a `a` (el primer in_transit del viaje).
      for (const minutesAgo of [100, 50, 10]) {
        await positionRepo.create({ shipmentId: a.shipmentId, tripId: trip.id, ...PICKUP, accuracyM: 5, capturedAt: t(minutesAgo) });
      }

      const traceA = await positionRepo.listCustodyTrace(a.shipmentId);
      const traceB = await positionRepo.listCustodyTrace(b.shipmentId);

      expect(traceA.map((p) => p.capturedAt)).toEqual([t(100), t(50)]);
      // `b`: desde su retiro (hace 60 min), sin entrega todavía. Las filas son de `a`.
      expect(traceB.map((p) => p.capturedAt)).toEqual([t(50), t(10)]);
      expect(traceB.every((p) => p.shipmentId === a.shipmentId)).toBe(true);
    });

    it("la purga no borra la traza de un viaje mientras otro envío del mismo viaje siga en disputa", async () => {
      const trip = await createTrip(TripStatus.COMPLETED, new Date(Date.now() - 60 * 24 * HOUR_MS));
      const delivered = await createShipment(trip.id, ShipmentStatus.DELIVERED);
      const disputed = await createShipment(trip.id, ShipmentStatus.DISPUTED);
      const longAgo = new Date(Date.now() - 40 * 24 * HOUR_MS);
      await app.db.shipment.updateMany({ data: { lastStatusChangedAt: longAgo } });
      await positionRepo.create({ shipmentId: delivered.shipmentId, tripId: trip.id, ...PICKUP, accuracyM: 5, capturedAt: longAgo });

      expect(await positionRepo.purgeEligibleClosedShipments(new Date(), 30)).toBe(0);

      await app.db.shipment.update({ where: { id: disputed.shipmentId }, data: { status: ShipmentStatus.COMPLETED } });
      expect(await positionRepo.purgeEligibleClosedShipments(new Date(), 30)).toBe(1);
    });
  });

  describe("detalle del envío (AC14)", () => {
    it("carrierTripActive refleja el viaje del transportista", async () => {
      const declared = await createTrip(TripStatus.DECLARED);
      const pending = await createShipment(declared.id);
      await app.db.trip.update({ where: { id: declared.id }, data: { carrierId: randomUUID() } });
      const active = await createTrip(TripStatus.ACTIVE, new Date());
      const live = await createShipment(active.id);

      const detail = (shipmentId: string, senderId: string) =>
        app.inject({ method: "GET", url: `/shipments/${shipmentId}`, headers: { "x-user-id": senderId } });
      expect((await detail(pending.shipmentId, pending.senderId)).json().carrierTripActive).toBe(false);
      expect((await detail(live.shipmentId, live.senderId)).json().carrierTripActive).toBe(true);
    });
  });
});
