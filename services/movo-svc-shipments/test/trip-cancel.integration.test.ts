import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { OfferStatus, ShipmentStatus, TripStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import {
  createTripRepository,
  TripRepository,
  TripNotFoundError,
  TripNotDeclaredError,
  TripHasAcceptedPackagesError,
} from "../src/repositories/trip-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { PackageType, PhotoStage } from "../src/models/shipment";
import { CreateTripInput } from "../src/models/trip";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

/**
 * MOVO-260: cancelación lógica (`cancel()`), desasociación de ofertas `pending` al dar de
 * baja un viaje (cancelación y barrido de vencidos) y listado por `scope`. Contra Postgres
 * real -- el compare-and-swap y la transacción que desasocia las ofertas no son
 * representables con un mock.
 */
describe("trip-repository (Postgres) — cancelación lógica y scope (MOVO-260)", () => {
  let app: FastifyInstance;
  let tripRepo: TripRepository;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;

  function baseTripInput(overrides: Partial<CreateTripInput> = {}): CreateTripInput {
    return {
      carrierId: randomUUID(),
      originAddress: "Av. Colón 1234, Córdoba",
      originLat: -31.4201,
      originLng: -64.1888,
      destinationAddress: "Av. San Martín 100, Villa María",
      destinationLat: -32.4104,
      destinationLng: -63.2404,
      departureAt: new Date(Date.now() + 24 * HOUR_MS),
      vehicleType: "auto",
      ...overrides,
    };
  }

  async function createPublishedShipment(): Promise<string> {
    const created = await shipmentRepo.create({
      senderId: randomUUID(),
      receiverId: randomUUID(),
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
      pickupDate: PICKUP_DATE,
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 4500,
    });
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    return created.id;
  }

  async function createPendingOffer(tripId: string, carrierId: string) {
    const shipmentId = await createPublishedShipment();
    return offerRepo.create({ shipmentId, carrierId, priceOffered: 5000, offeredDate: PICKUP_DATE, tripId });
  }

  async function createAcceptedOffer(tripId: string, carrierId: string) {
    const offer = await createPendingOffer(tripId, carrierId);
    const { offer: accepted } = await offerRepo.acceptOffer(offer.id, carrierId);
    return accepted;
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

  describe("cancel()", () => {
    it("transiciona declared -> cancelled y persiste cancelledAt", async () => {
      const trip = await tripRepo.create(baseTripInput());
      expect(trip.cancelledAt).toBeNull();

      const before = Date.now();
      const cancelled = await tripRepo.cancel(trip.id);

      expect(cancelled.status).toBe(TripStatus.CANCELLED);
      expect(cancelled.cancelledAt).not.toBeNull();
      expect(cancelled.cancelledAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);

      const reloaded = await tripRepo.findById(trip.id);
      expect(reloaded?.status).toBe(TripStatus.CANCELLED);
      expect(reloaded?.cancelledAt?.getTime()).toBe(cancelled.cancelledAt!.getTime());
    });

    it("lanza TripNotFoundError si el viaje no existe", async () => {
      await expect(tripRepo.cancel(randomUUID())).rejects.toThrow(TripNotFoundError);
    });

    it("lanza TripNotDeclaredError con un mensaje de cancelación (no de inicio) si el viaje está active", async () => {
      const trip = await tripRepo.create(baseTripInput());
      await tripRepo.start(trip.id);

      const err = await tripRepo.cancel(trip.id).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TripNotDeclaredError);
      expect((err as Error).message).toContain("no se puede cancelar");
      expect((err as Error).message).not.toContain("iniciar");
      expect((await tripRepo.findById(trip.id))?.status).toBe(TripStatus.ACTIVE);
    });

    it("lanza TripNotDeclaredError ante una segunda cancelación (double-tap)", async () => {
      const trip = await tripRepo.create(baseTripInput());
      await tripRepo.cancel(trip.id);

      await expect(tripRepo.cancel(trip.id)).rejects.toThrow(TripNotDeclaredError);
    });

    it("lanza TripHasAcceptedPackagesError y no toca el viaje si tiene un paquete aceptado", async () => {
      const carrierId = randomUUID();
      const trip = await tripRepo.create(baseTripInput({ carrierId }));
      await createAcceptedOffer(trip.id, carrierId);

      await expect(tripRepo.cancel(trip.id)).rejects.toThrow(TripHasAcceptedPackagesError);
      const reloaded = await tripRepo.findById(trip.id);
      expect(reloaded?.status).toBe(TripStatus.DECLARED);
      expect(reloaded?.cancelledAt).toBeNull();
    });

    it("desasocia las ofertas pending del viaje y no toca las de otro viaje", async () => {
      const carrierId = randomUUID();
      const trip = await tripRepo.create(baseTripInput({ carrierId }));
      const otherTrip = await tripRepo.create(baseTripInput({ carrierId }));
      const pending = await createPendingOffer(trip.id, carrierId);
      const otherPending = await createPendingOffer(otherTrip.id, carrierId);

      await tripRepo.cancel(trip.id);

      const [detached, untouched] = await Promise.all([
        app.db.offer.findUniqueOrThrow({ where: { id: pending.id } }),
        app.db.offer.findUniqueOrThrow({ where: { id: otherPending.id } }),
      ]);
      expect(detached.tripId).toBeNull();
      expect(detached.status).toBe(OfferStatus.PENDING);
      expect(untouched.tripId).toBe(otherTrip.id);
    });
  });

  describe("cancelOverdueDeclared()", () => {
    it("desasocia las ofertas pending del viaje que expira", async () => {
      const carrierId = randomUUID();
      const trip = await tripRepo.create(baseTripInput({ carrierId, departureAt: new Date(Date.now() - HOUR_MS) }));
      const pending = await createPendingOffer(trip.id, carrierId);

      expect(await tripRepo.cancelOverdueDeclared(new Date(), 100)).toEqual([trip.id]);

      const reloaded = await tripRepo.findById(trip.id);
      expect(reloaded?.status).toBe(TripStatus.EXPIRED);
      expect(reloaded?.cancelledAt).toBeNull();
      expect((await app.db.offer.findUniqueOrThrow({ where: { id: pending.id } })).tripId).toBeNull();
    });
  });

  describe("listByCarrier() con scope", () => {
    async function seedTripsInEveryStatus(carrierId: string) {
      const at = (hours: number) => new Date(Date.now() + hours * HOUR_MS);
      const declaredLater = await tripRepo.create(baseTripInput({ carrierId, departureAt: at(48) }));
      const declaredSooner = await tripRepo.create(baseTripInput({ carrierId, departureAt: at(24) }));
      const active = await tripRepo.create(baseTripInput({ carrierId, departureAt: at(36) }));
      await tripRepo.start(active.id);
      const cancelled = await tripRepo.create(baseTripInput({ carrierId, departureAt: at(-24) }));
      await tripRepo.cancel(cancelled.id);
      const expired = await tripRepo.create(baseTripInput({ carrierId, departureAt: at(-72) }));
      await tripRepo.cancelOverdueDeclared(new Date(), 100);
      const completed = await tripRepo.create(baseTripInput({ carrierId, departureAt: at(-48) }));
      await app.db.trip.update({ where: { id: completed.id }, data: { status: TripStatus.COMPLETED } });
      return { declaredLater, declaredSooner, active, cancelled, expired, completed };
    }

    it("upcoming: solo declared+active, ordenados por departureAt ascendente", async () => {
      const carrierId = randomUUID();
      const t = await seedTripsInEveryStatus(carrierId);

      const { items, total } = await tripRepo.listByCarrier(carrierId, 1, 20, undefined, "upcoming");

      expect(total).toBe(3);
      expect(items.map((i) => i.id)).toEqual([t.declaredSooner.id, t.active.id, t.declaredLater.id]);
    });

    it("history: solo completed+cancelled+expired, ordenados por departureAt descendente", async () => {
      const carrierId = randomUUID();
      const t = await seedTripsInEveryStatus(carrierId);

      const { items, total } = await tripRepo.listByCarrier(carrierId, 1, 20, undefined, "history");

      expect(total).toBe(3);
      expect(items.map((i) => i.id)).toEqual([t.cancelled.id, t.completed.id, t.expired.id]);
      expect(items.map((i) => i.status)).toEqual([TripStatus.CANCELLED, TripStatus.COMPLETED, TripStatus.EXPIRED]);
    });

    it("no mezcla viajes de otro transportista", async () => {
      const carrierId = randomUUID();
      await seedTripsInEveryStatus(carrierId);
      await tripRepo.create(baseTripInput());

      const { total } = await tripRepo.listByCarrier(carrierId, 1, 20, undefined, "upcoming");
      expect(total).toBe(3);
    });
  });
});
