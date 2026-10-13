import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createTripRepository, TripRepository } from "../src/repositories/trip-repository";
import { CreateTripInput } from "../src/models/trip";
import { attachAcceptedPackage } from "./trip-package-fixture";

const DEPARTURE_FROM = new Date("2030-03-15T03:00:00.000Z");
const DEPARTURE_TO = new Date("2030-03-16T03:00:00.000Z");

/** MOVO-240: la consulta del recordatorio del día anterior, contra Postgres real (el
 * `_count` filtrado por `ACCEPTED_OFFER_FILTER` no se puede probar con un mock). */
describe("trip-repository (Postgres) — findDeclaredForDepartureReminder (MOVO-240)", () => {
  let app: FastifyInstance;
  let tripRepo: TripRepository;

  function tripInput(overrides: Partial<CreateTripInput> = {}): CreateTripInput {
    return {
      carrierId: randomUUID(),
      originAddress: "Av. Colón 1234, Córdoba",
      originLat: -31.4201,
      originLng: -64.1888,
      destinationAddress: "Av. San Martín 100, Villa María",
      destinationLat: -32.4104,
      destinationLng: -63.2404,
      departureAt: new Date("2030-03-15T12:00:00.000Z"),
      vehicleType: "auto",
      ...overrides,
    };
  }

  function query(createdBefore = new Date(Date.now() + 60_000)) {
    return tripRepo.findDeclaredForDepartureReminder({
      departureFrom: DEPARTURE_FROM,
      departureTo: DEPARTURE_TO,
      createdBefore,
      limit: 100,
    });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({ tripExpirySweepEnabled: false, tripDepartureReminderSweepEnabled: false });
    await app.ready();
    tripRepo = createTripRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments, shipments.trips RESTART IDENTITY CASCADE");
  });

  it("trae los declared que salen dentro de la ventana, con sus paquetes aceptados vivos", async () => {
    const withPackages = await tripRepo.create(tripInput());
    await attachAcceptedPackage(app.db, withPackages, ShipmentStatus.ASSIGNMENT_PENDING);
    const cancelledPackage = await attachAcceptedPackage(app.db, withPackages);
    await app.db.shipment.update({
      where: { id: cancelledPackage.shipmentId },
      data: { status: ShipmentStatus.CANCELLED },
    });
    const empty = await tripRepo.create(tripInput());

    const result = await query();

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        {
          id: withPackages.id,
          carrierId: withPackages.carrierId,
          destinationAddress: "Av. San Martín 100, Villa María",
          acceptedPackagesCount: 1,
        },
        expect.objectContaining({ id: empty.id, acceptedPackagesCount: 0 }),
      ])
    );
  });

  it("deja afuera viajes de otro día o que ya no están declared", async () => {
    await tripRepo.create(tripInput({ departureAt: new Date("2030-03-16T03:00:00.000Z") }));
    await tripRepo.create(tripInput({ departureAt: new Date("2030-03-15T02:59:59.000Z") }));
    const cancelled = await tripRepo.create(tripInput());
    await tripRepo.cancel(cancelled.id);

    expect(await query()).toEqual([]);
  });

  it("deja afuera un viaje declarado después del corte de las 19:00", async () => {
    const cutoff = new Date();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await tripRepo.create(tripInput());

    expect(await query(cutoff)).toEqual([]);
  });
});
