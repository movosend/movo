import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { OfferStatus, ShipmentStatus, TripStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createTripRepository, TripRepository, TripHasNoPackagesError } from "../src/repositories/trip-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { createShipmentsService } from "../src/modules/shipments/shipments.service";
import { PackageType, PhotoStage } from "../src/models/shipment";
import { CreateTripInput } from "../src/models/trip";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z"); // ya pasó
const HOUR_MS = 60 * 60 * 1000;

/**
 * MOVO-258: cierre automático de envíos, ofertas y viajes contra Postgres real.
 */
describe("expiración y cierre automático (MOVO-258, Postgres)", () => {
  let app: FastifyInstance;
  let tripRepo: TripRepository;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;

  const service = () =>
    createShipmentsService(shipmentRepo, createFakeUsersClient({}), createFakeNotificationsClient(), undefined, {
      offerRepository: offerRepo,
    });

  function tripInput(overrides: Partial<CreateTripInput> = {}): CreateTripInput {
    return {
      carrierId: randomUUID(),
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

  async function createPublished(pickupDate = PICKUP_DATE): Promise<string> {
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
      pickupLat: -31.4201,
      pickupLng: -64.1888,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: -31.4135,
      deliveryLng: -64.1811,
      pickupDate,
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 4500,
    });
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    return created.id;
  }

  /** Envío con oferta aceptada (-> assignment_pending) asociada a un viaje `declared`. */
  async function createAssignedWithTrip(tripOverrides: Partial<CreateTripInput> = {}) {
    const carrierId = randomUUID();
    const trip = await tripRepo.create(tripInput({ carrierId, ...tripOverrides }));
    const shipmentId = await createPublished();
    const offer = await offerRepo.create({ shipmentId, carrierId, priceOffered: 5000, offeredDate: PICKUP_DATE });
    await offerRepo.acceptOffer(offer.id, carrierId);
    await app.db.offer.update({ where: { id: offer.id }, data: { tripId: trip.id } });
    return { shipmentId, offerId: offer.id, trip, carrierId };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({ tripExpirySweepEnabled: false });
    await app.ready();
    tripRepo = createTripRepository(app.db);
    shipmentRepo = createShipmentRepository(app.db);
    offerRepo = createOfferRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments, shipments.trips RESTART IDENTITY CASCADE");
  });

  describe("D7: cancelar un envío cierra sus ofertas", () => {
    it("accepted y pending vigentes pasan a shipment_cancelled; el resto no se reetiqueta", async () => {
      const shipmentId = await createPublished();
      const accepted = await offerRepo.create({ shipmentId, carrierId: randomUUID(), priceOffered: 5000, offeredDate: PICKUP_DATE });
      const rejected = await offerRepo.create({ shipmentId, carrierId: randomUUID(), priceOffered: 5100, offeredDate: PICKUP_DATE });
      await offerRepo.reject(rejected.id);
      const expired = await offerRepo.create({
        shipmentId,
        carrierId: randomUUID(),
        priceOffered: 5200,
        offeredDate: PICKUP_DATE,
        expiresAt: new Date(Date.now() - HOUR_MS),
      });
      await offerRepo.acceptOffer(accepted.id, null);
      // Tras aceptar una, las demás pending quedaron superseded; creamos otra vigente aparte
      // sobre un envío distinto para probar el caso pending.
      const otherShipment = await createPublished();
      const pending = await offerRepo.create({ shipmentId: otherShipment, carrierId: randomUUID(), priceOffered: 1, offeredDate: PICKUP_DATE });

      await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.CANCELLED, null);
      await shipmentRepo.updateStatus(otherShipment, ShipmentStatus.CANCELLED, null);

      expect((await offerRepo.findById(accepted.id))?.status).toBe(OfferStatus.SHIPMENT_CANCELLED);
      expect((await offerRepo.findById(pending.id))?.status).toBe(OfferStatus.SHIPMENT_CANCELLED);
      expect((await offerRepo.findById(rejected.id))?.status).toBe(OfferStatus.REJECTED);
      expect((await offerRepo.findById(expired.id))?.status).toBe(OfferStatus.EXPIRED);
    });
  });

  describe("D1 + AC3: retiro no realizado y viaje destrabado", () => {
    it("cancela el envío, cierra la oferta y el viaje expira en la corrida siguiente", async () => {
      const { shipmentId, offerId, trip } = await createAssignedWithTrip();

      // Mientras el paquete está vivo, el viaje vencido queda bloqueado.
      expect(await tripRepo.cancelOverdueDeclared(new Date(), 100)).toEqual([]);

      const result = await service().expireUnpickedAssignedShipments();

      expect(result).toEqual({ expiredCount: 1, errorsCount: 0 });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.CANCELLED);
      expect((await offerRepo.findById(offerId))?.status).toBe(OfferStatus.SHIPMENT_CANCELLED);
      const events = await shipmentRepo.listEvents(shipmentId);
      expect(events.at(-1)?.reason).toContain("El retiro no se realizó");

      expect(await tripRepo.cancelOverdueDeclared(new Date(), 100)).toEqual([trip.id]);
      // ADR-029 (MOVO-260): la baja automática de un viaje es `expired`, no `cancelled`.
      expect((await tripRepo.findById(trip.id))?.status).toBe(TripStatus.EXPIRED);
    });

    it("no toca un envío dentro del margen de gracia", async () => {
      const { shipmentId } = await createAssignedWithTrip();
      // Ventana cerró hace ~1h: dentro de las 24h de gracia.
      await app.db.shipment.update({
        where: { id: shipmentId },
        data: { pickupDate: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) },
      });
      const lenient = createShipmentsService(shipmentRepo, createFakeUsersClient({}), undefined, undefined, {
        pickupMissedGraceHours: 24,
      });

      expect((await lenient.expireUnpickedAssignedShipments()).expiredCount).toBe(0);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
    });
  });

  describe("D6: published con ofertas vigentes", () => {
    it("se conserva mientras haya una oferta vigente y se cancela cuando ya no queda ninguna", async () => {
      const shipmentId = await createPublished();
      const offer = await offerRepo.create({
        shipmentId,
        carrierId: randomUUID(),
        priceOffered: 5000,
        offeredDate: PICKUP_DATE,
        expiresAt: new Date(Date.now() + HOUR_MS),
      });

      expect(await service().expireOverduePublishedShipments()).toMatchObject({ expiredCount: 0, keptForOffersCount: 1 });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.PUBLISHED);

      await app.db.offer.update({ where: { id: offer.id }, data: { expiresAt: new Date(Date.now() - HOUR_MS) } });

      expect(await service().expireOverduePublishedShipments()).toMatchObject({ expiredCount: 1, keptForOffersCount: 0 });
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.CANCELLED);
      // La oferta vencida por fecha queda expired, no shipment_cancelled.
      expect((await offerRepo.findById(offer.id))?.status).toBe(OfferStatus.EXPIRED);
    });
  });

  describe("D5: viajes active", () => {
    async function activeTripWithShipment(finalStatus: ShipmentStatus | null) {
      const { shipmentId, trip, carrierId } = await createAssignedWithTrip({ departureAt: new Date(Date.now() + HOUR_MS) });
      await tripRepo.start(trip.id);
      if (finalStatus === ShipmentStatus.DELIVERED) {
        await app.db.shipment.update({ where: { id: shipmentId }, data: { status: ShipmentStatus.IN_TRANSIT } });
        await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.DELIVERED, carrierId);
      } else if (finalStatus) {
        await app.db.shipment.update({ where: { id: shipmentId }, data: { status: finalStatus } });
      }
      return { tripId: trip.id, shipmentId };
    }

    it("pasa a completed cuando todos sus paquetes se entregaron", async () => {
      const { tripId } = await activeTripWithShipment(ShipmentStatus.DELIVERED);

      expect(await tripRepo.completeFinishedActive(100)).toEqual([tripId]);
      expect((await tripRepo.findById(tripId))?.status).toBe(TripStatus.COMPLETED);
    });

    it.each([ShipmentStatus.IN_TRANSIT, ShipmentStatus.DISPUTED, ShipmentStatus.ASSIGNMENT_PENDING])(
      "sigue active si un paquete está %s",
      async (status) => {
        const { tripId } = await activeTripWithShipment(status);

        expect(await tripRepo.completeFinishedActive(100)).toEqual([]);
        expect((await tripRepo.findById(tripId))?.status).toBe(TripStatus.ACTIVE);
      }
    );

    it("completeFinishedActive no toca un viaje active sin paquetes ni uno declared", async () => {
      const empty = await tripRepo.create(tripInput({ departureAt: new Date(Date.now() + HOUR_MS) }));
      await app.db.trip.update({ where: { id: empty.id }, data: { status: TripStatus.ACTIVE } });
      const declared = await tripRepo.create(tripInput({ departureAt: new Date(Date.now() + HOUR_MS) }));

      expect(await tripRepo.completeFinishedActive(100)).toEqual([]);
      expect((await tripRepo.findById(empty.id))?.status).toBe(TripStatus.ACTIVE);
      expect((await tripRepo.findById(declared.id))?.status).toBe(TripStatus.DECLARED);
    });

    it("expireActiveWithoutPackages expira un active al que se le cancelaron todos los paquetes", async () => {
      const { tripId, shipmentId } = await activeTripWithShipment(null);

      // Con un paquete vivo no se toca.
      expect(await tripRepo.expireActiveWithoutPackages(100)).toEqual([]);

      await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.CANCELLED, null);

      expect(await tripRepo.expireActiveWithoutPackages(100)).toEqual([tripId]);
      expect((await tripRepo.findById(tripId))?.status).toBe(TripStatus.EXPIRED);
    });

    it("expireActiveWithoutPackages no toca un declared sin paquetes ni un active con paquete entregado", async () => {
      const declared = await tripRepo.create(tripInput({ departureAt: new Date(Date.now() + HOUR_MS) }));
      const { tripId } = await activeTripWithShipment(ShipmentStatus.DELIVERED);

      expect(await tripRepo.expireActiveWithoutPackages(100)).toEqual([]);
      expect((await tripRepo.findById(declared.id))?.status).toBe(TripStatus.DECLARED);
      expect((await tripRepo.findById(tripId))?.status).toBe(TripStatus.ACTIVE);
    });

    it("start() rechaza un viaje sin paquetes (con o sin salida vencida) pero deja iniciar uno con paquete", async () => {
      const future = await tripRepo.create(tripInput({ departureAt: new Date(Date.now() + HOUR_MS) }));
      await expect(tripRepo.start(future.id)).rejects.toBeInstanceOf(TripHasNoPackagesError);

      const overdue = await tripRepo.create(tripInput());
      await expect(tripRepo.start(overdue.id)).rejects.toMatchObject({ departurePassed: true });

      const { trip } = await createAssignedWithTrip();
      await expect(tripRepo.start(trip.id)).resolves.toMatchObject({ status: TripStatus.ACTIVE });
    });
  });

  describe("D4: in_transit anómalo", () => {
    it("lista los in_transit sin marcar y la marca es compare-and-swap", async () => {
      const { shipmentId } = await createAssignedWithTrip();
      await app.db.shipment.update({ where: { id: shipmentId }, data: { status: ShipmentStatus.IN_TRANSIT } });

      expect((await shipmentRepo.findInTransitUnflagged(10)).map((s) => s.id)).toEqual([shipmentId]);
      expect(await shipmentRepo.flagTransitAnomaly(shipmentId)).toBe(true);
      expect(await shipmentRepo.flagTransitAnomaly(shipmentId)).toBe(false);
      expect(await shipmentRepo.findInTransitUnflagged(10)).toEqual([]);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(ShipmentStatus.IN_TRANSIT);
    });

    it("el barrido marca el envío sin cancelarlo", async () => {
      const { shipmentId } = await createAssignedWithTrip();
      await app.db.shipment.update({
        where: { id: shipmentId },
        data: { status: ShipmentStatus.IN_TRANSIT, lastStatusChangedAt: new Date(Date.now() - 72 * HOUR_MS) },
      });

      expect(await service().flagAnomalousInTransitShipments()).toEqual({ flaggedCount: 1, errorsCount: 0 });
      const after = await shipmentRepo.findById(shipmentId);
      expect(after?.status).toBe(ShipmentStatus.IN_TRANSIT);
      expect(after?.transitAnomalyFlaggedAt).not.toBeNull();
    });
  });
});
