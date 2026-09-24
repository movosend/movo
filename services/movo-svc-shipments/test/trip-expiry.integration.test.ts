import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus, TripStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createTripRepository, TripRepository } from "../src/repositories/trip-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { PackageType, PhotoStage } from "../src/models/shipment";
import { CreateTripInput } from "../src/models/trip";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

/**
 * MOVO-238: `cancelOverdueDeclared` -- solo un `declared` con `departureAt` vencido y sin
 * paquetes aceptados pasa a `cancelled`; `active` nunca se toca (AC4) y un vencido con
 * paquete aceptado queda intacto (AC2, bloquea sin cascadear, mismo criterio que MOVO-134).
 */
describe("trip-repository (Postgres) — cancelOverdueDeclared (MOVO-238)", () => {
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
      departureAt: new Date(Date.now() - HOUR_MS),
      vehicleType: "auto",
      ...overrides,
    };
  }

  /** Viaje `declared` vencido con una oferta `accepted` taggeada con su `tripId`
   * (simula el cableado de `createOfferForShipment`, mismo criterio que
   * `trip-repository.integration.test.ts`). */
  async function createTripWithAcceptedOffer(finalShipmentStatus?: ShipmentStatus) {
    const carrierId = randomUUID();
    const trip = await tripRepo.create(baseTripInput({ carrierId }));
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
    const offer = await offerRepo.create({
      shipmentId: created.id,
      carrierId,
      priceOffered: 5000,
      offeredDate: PICKUP_DATE,
    });
    const { offer: accepted } = await offerRepo.acceptOffer(offer.id, carrierId);
    await app.db.offer.update({ where: { id: accepted.id }, data: { tripId: trip.id } });
    if (finalShipmentStatus) {
      await shipmentRepo.updateStatus(created.id, finalShipmentStatus, carrierId);
    }
    return trip;
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

  it("cancela un declared vencido sin ofertas y refresca updatedAt (AC1/AC5)", async () => {
    const trip = await tripRepo.create(baseTripInput());

    const cancelled = await tripRepo.cancelOverdueDeclared(new Date(), 100);

    expect(cancelled).toEqual([trip.id]);
    const after = await tripRepo.findById(trip.id);
    expect(after?.status).toBe(TripStatus.CANCELLED);
    expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(trip.updatedAt.getTime());
  });

  it("no toca un declared cuyo departureAt todavía no llegó", async () => {
    const trip = await tripRepo.create(baseTripInput({ departureAt: new Date(Date.now() + HOUR_MS) }));

    expect(await tripRepo.cancelOverdueDeclared(new Date(), 100)).toEqual([]);
    expect((await tripRepo.findById(trip.id))?.status).toBe(TripStatus.DECLARED);
  });

  it("nunca toca un viaje active vencido (AC4)", async () => {
    const declared = await tripRepo.create(baseTripInput());
    const active = await tripRepo.start(declared.id);

    expect(await tripRepo.cancelOverdueDeclared(new Date(), 100)).toEqual([]);
    expect((await tripRepo.findById(active.id))?.status).toBe(TripStatus.ACTIVE);
  });

  it("deja intacto un declared vencido con un paquete aceptado (AC2)", async () => {
    const trip = await createTripWithAcceptedOffer();

    expect(await tripRepo.cancelOverdueDeclared(new Date(), 100)).toEqual([]);
    expect((await tripRepo.findById(trip.id))?.status).toBe(TripStatus.DECLARED);
  });

  it("cancela un declared vencido cuyo único paquete aceptado ya fue cancelado", async () => {
    const trip = await createTripWithAcceptedOffer(ShipmentStatus.CANCELLED);

    expect(await tripRepo.cancelOverdueDeclared(new Date(), 100)).toEqual([trip.id]);
  });

  it("respeta el tamaño de lote, tomando primero los más viejos", async () => {
    const oldest = await tripRepo.create(baseTripInput({ departureAt: new Date(Date.now() - 3 * HOUR_MS) }));
    await tripRepo.create(baseTripInput({ departureAt: new Date(Date.now() - 2 * HOUR_MS) }));

    expect(await tripRepo.cancelOverdueDeclared(new Date(), 1)).toEqual([oldest.id]);
  });
});
