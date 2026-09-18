import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus, TripStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import {
  createTripRepository,
  TripRepository,
  TripNotFoundError,
  TripNotDeclaredError,
  TripAlreadyHasActiveTripError,
} from "../src/repositories/trip-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { CreateTripInput } from "../src/models/trip";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");

/**
 * MOVO-221: rediseño de estados de viaje (declared -> active -> completed) y límite
 * de 1 viaje `active` por transportista. Contra Postgres real -- el límite de "1
 * active" y el compare-and-swap de `start()` dependen del índice único parcial
 * `trips_carrier_active_unique`, no representables con un mock.
 */
describe("trip-repository (Postgres) — ciclo de vida declared/active", () => {
  let app: FastifyInstance;
  let tripRepo: TripRepository;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;

  const baseShipmentInput: CreateShipmentInput = {
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
  };

  function baseTripInput(overrides: Partial<CreateTripInput> = {}): CreateTripInput {
    return {
      carrierId: randomUUID(),
      originAddress: "Av. Colón 1234, Córdoba",
      originLat: -31.4201,
      originLng: -64.1888,
      destinationAddress: "Av. San Martín 100, Villa María",
      destinationLat: -32.4104,
      destinationLng: -63.2404,
      departureAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      vehicleType: "auto",
      ...overrides,
    };
  }

  async function createPublishedShipment(overrides: Partial<CreateShipmentInput> = {}): Promise<string> {
    const created = await shipmentRepo.create({ ...baseShipmentInput, ...overrides });
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    const published = await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    return published.id;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
    tripRepo = createTripRepository(app.db);
    shipmentRepo = createShipmentRepository(app.db);
    offerRepo = createOfferRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // shipments.trips no tiene FK hacia shipments -- cada test usa carrierId propio
    // (randomUUID), sin colisión posible entre corridas (mismo criterio que
    // trip-repository.integration.test.ts). CASCADE también vacía shipments.offers.
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  it("create() usa 'declared' como estado inicial, no 'active'", async () => {
    const trip = await tripRepo.create(baseTripInput());
    expect(trip.status).toBe(TripStatus.DECLARED);
  });

  it("start() transiciona declared -> active y persiste el cambio", async () => {
    const trip = await tripRepo.create(baseTripInput());

    const started = await tripRepo.start(trip.id);
    expect(started.status).toBe(TripStatus.ACTIVE);

    const reloaded = await tripRepo.findById(trip.id);
    expect(reloaded?.status).toBe(TripStatus.ACTIVE);
  });

  it("start() lanza TripNotFoundError si el viaje no existe", async () => {
    await expect(tripRepo.start(randomUUID())).rejects.toThrow(TripNotFoundError);
  });

  it("start() lanza TripNotDeclaredError ante un segundo start (double-tap)", async () => {
    const trip = await tripRepo.create(baseTripInput());
    await tripRepo.start(trip.id);

    await expect(tripRepo.start(trip.id)).rejects.toThrow(TripNotDeclaredError);
  });

  it("start() lanza TripNotDeclaredError si el viaje está cancelled", async () => {
    const trip = await tripRepo.create(baseTripInput());
    await tripRepo.update(trip.id, { status: TripStatus.CANCELLED });

    await expect(tripRepo.start(trip.id)).rejects.toThrow(TripNotDeclaredError);
  });

  it("start() lanza TripAlreadyHasActiveTripError si el transportista ya tiene otro viaje active", async () => {
    const carrierId = randomUUID();
    const tripA = await tripRepo.create(baseTripInput({ carrierId }));
    const tripB = await tripRepo.create(baseTripInput({ carrierId }));

    await tripRepo.start(tripA.id);

    await expect(tripRepo.start(tripB.id)).rejects.toThrow(TripAlreadyHasActiveTripError);

    // tripB sigue declared -- el intento fallido no lo dejó a mitad de camino.
    const reloadedB = await tripRepo.findById(tripB.id);
    expect(reloadedB?.status).toBe(TripStatus.DECLARED);
  });

  it("dos start() concurrentes sobre dos viajes declared del MISMO transportista: exactamente uno gana", async () => {
    const carrierId = randomUUID();
    const tripA = await tripRepo.create(baseTripInput({ carrierId }));
    const tripB = await tripRepo.create(baseTripInput({ carrierId }));

    const results = await Promise.allSettled([tripRepo.start(tripA.id), tripRepo.start(tripB.id)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TripAlreadyHasActiveTripError);

    // Persistencia: exactamente uno de los dos quedó active, el otro sigue declared.
    const [reloadedA, reloadedB] = await Promise.all([tripRepo.findById(tripA.id), tripRepo.findById(tripB.id)]);
    const statuses = [reloadedA?.status, reloadedB?.status].sort();
    expect(statuses).toEqual([TripStatus.ACTIVE, TripStatus.DECLARED].sort());
  });

  it("update() (PATCH) respeta el mismo límite si se fuerza status:active a mano", async () => {
    const carrierId = randomUUID();
    const tripA = await tripRepo.create(baseTripInput({ carrierId }));
    const tripB = await tripRepo.create(baseTripInput({ carrierId }));
    await tripRepo.start(tripA.id);

    await expect(tripRepo.update(tripB.id, { status: TripStatus.ACTIVE })).rejects.toThrow(
      TripAlreadyHasActiveTripError,
    );
  });

  it("un viaje active no bloquea a OTRO transportista de iniciar el suyo (aislamiento por carrierId)", async () => {
    const tripA = await tripRepo.create(baseTripInput());
    const tripB = await tripRepo.create(baseTripInput());

    await expect(tripRepo.start(tripA.id)).resolves.toMatchObject({ status: TripStatus.ACTIVE });
    await expect(tripRepo.start(tripB.id)).resolves.toMatchObject({ status: TripStatus.ACTIVE });
  });

  /**
   * MOVO-221 ("validación pedida — ya se cumple, sin cambio de código necesario"):
   * un envío no puede terminar asociado a más de un viaje a la vez. `Offer.tripId`
   * vive en `Offer`, no en `Shipment` -- `acceptOffer()` (MOVO-102/144) ya marca
   * `superseded` cualquier otra oferta `pending` del mismo envío al aceptar una, así
   * que solo puede existir una oferta `accepted` por envío en simultáneo. Test
   * explícito pedido por el ticket, de punta a punta contra Postgres real.
   */
  it("un envío nunca queda asociado a más de un viaje: aceptar una oferta supersede a las demás, aunque apunten a viajes distintos", async () => {
    const carrierA = randomUUID();
    const carrierB = randomUUID();
    const tripA = await tripRepo.create(baseTripInput({ carrierId: carrierA }));
    const tripB = await tripRepo.create(baseTripInput({ carrierId: carrierB }));

    const shipmentId = await createPublishedShipment();

    const offerA = await offerRepo.create({
      shipmentId,
      carrierId: carrierA,
      priceOffered: 5000,
      offeredDate: PICKUP_DATE,
      tripId: tripA.id,
    });
    const offerB = await offerRepo.create({
      shipmentId,
      carrierId: carrierB,
      priceOffered: 5200,
      offeredDate: PICKUP_DATE,
      tripId: tripB.id,
    });

    const { offer: accepted, superseded } = await offerRepo.acceptOffer(offerA.id, baseShipmentInput.senderId);

    expect(accepted.status).toBe("accepted");
    expect(accepted.tripId).toBe(tripA.id);
    expect(superseded.map((s) => s.id)).toEqual([offerB.id]);

    const offerBReloaded = await offerRepo.findById(offerB.id);
    expect(offerBReloaded?.status).toBe("superseded");

    // Único lugar de verdad: a lo sumo una oferta accepted por envío, y su tripId
    // es el único viaje al que el envío queda ligado.
    const allOffers = await offerRepo.listByShipment(shipmentId);
    const acceptedOffers = allOffers.filter((o) => o.status === "accepted");
    expect(acceptedOffers).toHaveLength(1);
    expect(acceptedOffers[0]?.tripId).toBe(tripA.id);
  });
});
