import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createTripRepository, TripRepository, TripHasAcceptedPackagesError } from "../src/repositories/trip-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { CreateTripInput } from "../src/models/trip";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");

/**
 * Fix de MOVO-162: `Trip.hasAcceptedPackages` (y las guardas de `update`/`delete`) tienen
 * que ignorar una oferta `accepted` cuyo envío ya está `cancelled` -- sin esto, un viaje
 * quedaba bloqueado para siempre aunque el emisor cancelara el envío (`cancelShipment` no
 * toca la fila de `Offer`, ver CLAUDE.md). Hoy no existe ningún flujo de la app que
 * escriba `Offer.tripId` (nada en `offers.service.ts`/`createOfferForShipment` lo acepta
 * todavía, columna sin cablear) -- estos tests lo simulan escribiéndolo directo vía
 * Prisma (`app.db.offer.update`), válido acá porque lo que se prueba es la query de
 * `trip-repository.ts`, no el flujo de creación de oferta.
 */
describe("trip-repository (Postgres) — hasAcceptedPackages ignora envíos cancelados", () => {
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

  /** Mismo helper que `offer-repository.integration.test.ts` -- bypasea la máquina de
   * estados de Shipment a propósito, es fixture de test. */
  async function createPublishedShipment(): Promise<string> {
    const created = await shipmentRepo.create(baseShipmentInput);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    const published = await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    return published.id;
  }

  /** Declara un viaje, publica un envío, oferta y acepta esa oferta a nombre del
   * transportista del viaje, y taggea la oferta con `tripId` (simulando el cableado que
   * todavía no existe en `createOfferForShipment`). Devuelve el viaje y la oferta ya
   * `accepted`. */
  async function createTripWithAcceptedOffer(carrierId = randomUUID()) {
    const trip = await tripRepo.create(baseTripInput({ carrierId }));
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create({
      shipmentId,
      carrierId,
      priceOffered: 5000,
      offeredDate: PICKUP_DATE,
    });
    const { offer: accepted } = await offerRepo.acceptOffer(offer.id, carrierId);
    await app.db.offer.update({ where: { id: accepted.id }, data: { tripId: trip.id } });
    return { trip, shipmentId, offerId: accepted.id };
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
    // CASCADE también vacía shipments.offers (FK a shipments.shipments). shipments.trips
    // no tiene FK hacia shipments, así que no se trunca acá -- cada test usa carrierId
    // propio (randomUUID), sin colisión posible entre corridas.
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  it("una oferta accepted cuyo envío sigue activo (assignment_pending) SÍ cuenta como paquete aceptado (caso feliz, no regresionar)", async () => {
    const { trip } = await createTripWithAcceptedOffer();

    expect(await tripRepo.countAcceptedOffers(trip.id)).toBe(1);
  });

  it("una oferta accepted cuyo envío fue cancelado NO cuenta como paquete aceptado", async () => {
    const { trip, shipmentId } = await createTripWithAcceptedOffer();

    await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.CANCELLED, trip.carrierId, "Cambio de planes");

    expect(await tripRepo.countAcceptedOffers(trip.id)).toBe(0);
  });

  it("update()/delete() siguen bloqueados con TripHasAcceptedPackagesError mientras el envío sigue activo", async () => {
    const { trip } = await createTripWithAcceptedOffer();

    await expect(tripRepo.update(trip.id, { vehicleType: "camioneta" })).rejects.toThrow(
      TripHasAcceptedPackagesError,
    );
    await expect(tripRepo.delete(trip.id)).rejects.toThrow(TripHasAcceptedPackagesError);
  });

  it("update()/delete() dejan de bloquearse una vez que el emisor cancela el envío tras la aceptación", async () => {
    const { trip, shipmentId } = await createTripWithAcceptedOffer();
    await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.CANCELLED, trip.carrierId);

    const updated = await tripRepo.update(trip.id, { vehicleType: "camioneta" });
    expect(updated.vehicleType).toBe("camioneta");

    // El viaje sigue existiendo tras el update -- probamos delete() sobre un viaje nuevo
    // para no depender de que el anterior ya no exista.
    const { trip: secondTrip, shipmentId: secondShipmentId } = await createTripWithAcceptedOffer();
    await shipmentRepo.updateStatus(secondShipmentId, ShipmentStatus.CANCELLED, secondTrip.carrierId);

    await expect(tripRepo.delete(secondTrip.id)).resolves.toBeUndefined();
    expect(await tripRepo.findById(secondTrip.id)).toBeNull();
  });

  it("listByCarrier() expone hasAcceptedPackages: false una vez que el envío asociado fue cancelado", async () => {
    const carrierId = randomUUID();
    const { trip, shipmentId } = await createTripWithAcceptedOffer(carrierId);

    const beforeCancel = await tripRepo.listByCarrier(carrierId, 1, 20);
    expect(beforeCancel.items.find((t) => t.id === trip.id)?.hasAcceptedPackages).toBe(true);

    await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.CANCELLED, carrierId);

    const afterCancel = await tripRepo.listByCarrier(carrierId, 1, 20);
    expect(afterCancel.items.find((t) => t.id === trip.id)?.hasAcceptedPackages).toBe(false);
  });

  it("una oferta accepted de OTRO viaje del mismo transportista no bloquea este viaje (aislamiento por tripId)", async () => {
    const carrierId = randomUUID();
    const { trip: tripA } = await createTripWithAcceptedOffer(carrierId);
    const tripB = await tripRepo.create(baseTripInput({ carrierId }));

    expect(await tripRepo.countAcceptedOffers(tripB.id)).toBe(0);
    await expect(tripRepo.delete(tripB.id)).resolves.toBeUndefined();
    // tripA sigue bloqueado -- no se vio afectado por operar sobre tripB.
    expect(await tripRepo.countAcceptedOffers(tripA.id)).toBe(1);
  });
});
