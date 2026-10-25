import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus, TripStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createTripRepository, TripRepository } from "../src/repositories/trip-repository";
import { createShipmentsService } from "../src/modules/shipments/shipments.service";
import { NotificationsClient } from "../src/adapters/notifications-client";
import { CreateTripInput } from "../src/models/trip";
import { attachAcceptedPackage } from "./trip-package-fixture";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient } from "./fake-payments-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { createFakePricingClient } from "./fake-pricing-client";
import { createFakePricingLogisticsClient } from "./fake-pricing-logistics-client";

const HOUR_MS = 60 * 60 * 1000;

/**
 * MOVO-278 (DD-045): salida de un `in_transit` demorado contra Postgres/Redis reales:
 * aviso previo, disputa automática, cierre del viaje, bloqueo del transportista y la
 * marca expuesta en los endpoints de envíos activos y en el detalle.
 */
describe("salida del in_transit demorado (Postgres, MOVO-278)", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let tripRepo: TripRepository;
  let notifications: NotificationsClient;

  const service = () => createShipmentsService(shipmentRepo, createFakeUsersClient({}), notifications);

  function tripInput(carrierId: string, overrides: Partial<CreateTripInput> = {}): CreateTripInput {
    return {
      carrierId,
      originAddress: "Av. Colón 1234, Córdoba",
      originLat: -31.4201,
      originLng: -64.1888,
      destinationAddress: "Av. San Martín 100, Villa María",
      destinationLat: -32.4104,
      destinationLng: -63.2404,
      departureAt: new Date(Date.now() - HOUR_MS),
      vehicleType: "auto",
      ...overrides,
    };
  }

  /** Viaje `active` con un único paquete `in_transit`, marcado como demorado hace `flaggedHoursAgo`. */
  async function inTransitPackage(
    flaggedHoursAgo: number | null,
    carrierId = randomUUID(),
    warnedHoursAgo: number | null = null
  ) {
    const trip = await tripRepo.create(tripInput(carrierId));
    const { shipmentId } = await attachAcceptedPackage(app.db, trip, ShipmentStatus.IN_TRANSIT);
    await app.db.trip.update({ where: { id: trip.id }, data: { status: TripStatus.ACTIVE } });
    await app.db.shipment.update({
      where: { id: shipmentId },
      data: {
        transitAnomalyFlaggedAt: flaggedHoursAgo === null ? null : new Date(Date.now() - flaggedHoursAgo * HOUR_MS),
        transitAnomalyWarnedAt: warnedHoursAgo === null ? null : new Date(Date.now() - warnedHoursAgo * HOUR_MS),
      },
    });
    return { shipmentId, trip, carrierId };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({
      usersClient: createFakeUsersClient({}),
      paymentsClient: createFakePaymentsClient(),
      notificationsClient: createFakeNotificationsClient(),
      pricingClient: createFakePricingClient(),
      pricingLogisticsClient: createFakePricingLogisticsClient(),
      sweepEnabled: false,
      tripExpirySweepEnabled: false,
      transitAnomalySweepEnabled: false,
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
    tripRepo = createTripRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    notifications = createFakeNotificationsClient();
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments, shipments.trips RESTART IDENTITY CASCADE");
  });

  describe("aviso previo (AC8)", () => {
    it("se manda una sola vez, solo a envíos marcados que siguen in_transit", async () => {
      const due = await inTransitPackage(13);
      const tooSoon = await inTransitPackage(5);
      const delivered = await inTransitPackage(13);
      await shipmentRepo.updateStatus(delivered.shipmentId, ShipmentStatus.DELIVERED, null);

      expect(await service().warnFlaggedInTransitShipments()).toEqual({ warnedCount: 1, errorsCount: 0 });
      await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalledTimes(1));
      expect(notifications.sendPush).toHaveBeenCalledWith(expect.objectContaining({ userId: due.carrierId }));
      expect((await shipmentRepo.findById(due.shipmentId))?.transitAnomalyWarnedAt).not.toBeNull();
      expect((await shipmentRepo.findById(tooSoon.shipmentId))?.transitAnomalyWarnedAt).toBeNull();
      expect((await shipmentRepo.findById(delivered.shipmentId))?.transitAnomalyWarnedAt).toBeNull();

      expect(await service().warnFlaggedInTransitShipments()).toEqual({ warnedCount: 0, errorsCount: 0 });
      expect(notifications.sendPush).toHaveBeenCalledTimes(1);
    });
  });

  describe("disputa automática (AC3/AC6)", () => {
    it("pasa a disputed solo los marcados y vencidos, con evento sin actor, y es idempotente", async () => {
      const overdue = await inTransitPackage(25, randomUUID(), 13);
      const recent = await inTransitPackage(5);
      const unflagged = await inTransitPackage(null);

      expect(await service().disputeOverdueFlaggedShipments()).toEqual({ disputedCount: 1, errorsCount: 0 });

      expect((await shipmentRepo.findById(overdue.shipmentId))?.status).toBe(ShipmentStatus.DISPUTED);
      expect((await shipmentRepo.findById(recent.shipmentId))?.status).toBe(ShipmentStatus.IN_TRANSIT);
      expect((await shipmentRepo.findById(unflagged.shipmentId))?.status).toBe(ShipmentStatus.IN_TRANSIT);
      const event = await app.db.shipmentEvent.findFirst({
        where: { shipmentId: overdue.shipmentId, toStatus: ShipmentStatus.DISPUTED },
      });
      expect(event).toMatchObject({ fromStatus: ShipmentStatus.IN_TRANSIT, actorId: null });
      expect(event?.reason).toContain("no se confirmó");
      await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalledTimes(3));
      // MOVO-334: la disputa automática se crea con la entidad, como disputa de sistema.
      expect(await app.db.dispute.findMany({ where: { shipmentId: overdue.shipmentId } })).toEqual([
        expect.objectContaining({ reason: "transit_anomaly", openedBy: null, status: "open" }),
      ]);

      expect(await service().disputeOverdueFlaggedShipments()).toEqual({ disputedCount: 0, errorsCount: 0 });
      expect(await app.db.shipmentEvent.count({ where: { toStatus: ShipmentStatus.DISPUTED } })).toBe(1);
    });

    it("un marcado hace más de 24 h pero sin aviso previo se avisa primero y recién después se disputa (backfill)", async () => {
      const { shipmentId } = await inTransitPackage(30);

      await service().warnFlaggedInTransitShipments();
      expect(await service().disputeOverdueFlaggedShipments()).toEqual({ disputedCount: 0, errorsCount: 0 });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.IN_TRANSIT);
      expect((await shipmentRepo.findById(shipmentId))?.transitAnomalyWarnedAt).not.toBeNull();

      // 12 h después del aviso ya cumplió el plazo que prometió la push.
      await app.db.shipment.update({
        where: { id: shipmentId },
        data: { transitAnomalyWarnedAt: new Date(Date.now() - 13 * HOUR_MS) },
      });
      expect(await service().disputeOverdueFlaggedShipments()).toEqual({ disputedCount: 1, errorsCount: 0 });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.DISPUTED);
    });

    it("una entrega confirmada antes del plazo queda delivered y el barrido no la toca", async () => {
      const { shipmentId } = await inTransitPackage(20);
      await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.DELIVERED, randomUUID());
      await app.db.shipment.update({
        where: { id: shipmentId },
        data: {
          transitAnomalyFlaggedAt: new Date(Date.now() - 25 * HOUR_MS),
          transitAnomalyWarnedAt: new Date(Date.now() - 13 * HOUR_MS),
        },
      });

      expect((await service().disputeOverdueFlaggedShipments()).disputedCount).toBe(0);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.DELIVERED);
    });
  });

  describe("viaje y bloqueo del transportista (AC4/AC9)", () => {
    it("el viaje se completa, pero el transportista no puede iniciar otro mientras la disputa siga abierta", async () => {
      const { shipmentId, trip, carrierId } = await inTransitPackage(25, randomUUID(), 13);
      await service().disputeOverdueFlaggedShipments();

      expect(await tripRepo.completeFinishedActive(10)).toEqual([trip.id]);
      expect((await tripRepo.findById(trip.id))?.status).toBe(TripStatus.COMPLETED);

      const next = await tripRepo.create(tripInput(carrierId, { departureAt: new Date() }));
      await attachAcceptedPackage(app.db, next);
      const start = () =>
        app.inject({
          method: "POST",
          url: `/trips/${next.id}/start`,
          headers: { "x-user-id": carrierId, "x-user-roles": "carrier" },
        });

      const blocked = await start();
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error).toMatchObject({
        code: "CARRIER_DISPUTE_OPEN",
        details: { missingRequirements: ["no_open_dispute"] },
      });
      expect((await tripRepo.findById(next.id))?.status).toBe(TripStatus.DECLARED);

      // La resolución (MOVO-34) todavía no existe: se simula sacando el envío de `disputed`.
      await app.db.shipment.update({ where: { id: shipmentId }, data: { status: ShipmentStatus.COMPLETED } });
      await app.db.dispute.updateMany({ where: { shipmentId }, data: { status: "resolved" } });
      expect((await start()).statusCode).toBe(200);
    });
  });

  describe("la marca en los endpoints (AC1)", () => {
    it("GET /shipments/sending|receiving|transporting y el detalle exponen transitAnomalyFlaggedAt", async () => {
      const { shipmentId, carrierId } = await inTransitPackage(3);
      const shipment = await shipmentRepo.findById(shipmentId);
      const flaggedAt = shipment!.transitAnomalyFlaggedAt!.toISOString();

      for (const [path, userId] of [
        ["sending", shipment!.senderId],
        ["receiving", shipment!.receiverId],
        ["transporting", carrierId],
      ] as const) {
        const response = await app.inject({ method: "GET", url: `/shipments/${path}`, headers: { "x-user-id": userId } });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual([expect.objectContaining({ id: shipmentId, transitAnomalyFlaggedAt: flaggedAt })]);
      }

      const detail = await app.inject({
        method: "GET",
        url: `/shipments/${shipmentId}`,
        headers: { "x-user-id": shipment!.senderId },
      });
      expect(detail.json().transitAnomalyFlaggedAt).toBe(flaggedAt);
    });

    it("sin marca viaja null", async () => {
      const { shipmentId, carrierId } = await inTransitPackage(null);

      const response = await app.inject({
        method: "GET",
        url: "/shipments/transporting",
        headers: { "x-user-id": carrierId },
      });
      expect(response.json()).toEqual([expect.objectContaining({ id: shipmentId, transitAnomalyFlaggedAt: null })]);
    });

    it("Swagger documenta el campo en los cuatro endpoints", async () => {
      const spec = app.swagger() as unknown as {
        paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      };
      for (const path of ["/shipments/sending", "/shipments/receiving", "/shipments/transporting", "/shipments/{id}"]) {
        expect(JSON.stringify(spec.paths[path].get.responses["200"])).toContain("transitAnomalyFlaggedAt");
      }
    });
  });
});
