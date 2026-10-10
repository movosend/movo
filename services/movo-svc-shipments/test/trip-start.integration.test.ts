import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus, TripStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createTripRepository, TripRepository } from "../src/repositories/trip-repository";
import { CreateTripInput } from "../src/models/trip";
import { attachAcceptedPackage } from "./trip-package-fixture";
import { createFakePricingLogisticsClient } from "./fake-pricing-logistics-client";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * MOVO-277: `POST /trips/:id/start` valida la fecha de salida y exige al menos un paquete
 * ejecutable (`assigned`/`in_transit`), y lo que la card cuenta como ejecutable es lo que
 * la ruta del viaje muestra. Contra Postgres/Redis reales, de punta a punta por HTTP.
 * El optimizador falla a propósito (fake sin `optimizeRoute`): `getMyRoute` cae a la ruta
 * degradada, que conserva todas las paradas compuestas, sin depender de OR-Tools.
 */
describe("POST /trips/:id/start (MOVO-277)", () => {
  let app: FastifyInstance;
  let tripRepo: TripRepository;
  // `GET /trips` exige un transportista verificado (`assertVerifiedCarrier`): cada test
  // que lo use registra acá el perfil de su carrier.
  const profiles: Parameters<typeof createFakeUsersClient>[0] = {};

  function tripInput(overrides: Partial<CreateTripInput> = {}): CreateTripInput {
    return {
      carrierId: randomUUID(),
      originAddress: "Av. Colón 1234, Córdoba",
      originLat: -31.4201,
      originLng: -64.1888,
      destinationAddress: "Av. San Martín 100, Villa María",
      destinationLat: -32.4104,
      destinationLng: -63.2404,
      departureAt: new Date(),
      vehicleType: "auto",
      ...overrides,
    };
  }

  function start(tripId: string, carrierId: string) {
    return app.inject({
      method: "POST",
      url: `/trips/${tripId}/start`,
      headers: { "x-user-id": carrierId, "x-user-roles": "carrier" },
    });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({
      pricingLogisticsClient: createFakePricingLogisticsClient(),
      usersClient: createFakeUsersClient(profiles),
    });
    await app.ready();
    tripRepo = createTripRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  it("responde 409 TRIP_START_TOO_EARLY con la salida en un día futuro y el viaje sigue declared", async () => {
    const trip = await tripRepo.create(tripInput({ departureAt: new Date(Date.now() + 2 * DAY_MS) }));
    await attachAcceptedPackage(app.db, trip);

    const res = await start(trip.id, trip.carrierId);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TRIP_START_TOO_EARLY");
    expect((await tripRepo.findById(trip.id))?.status).toBe(TripStatus.DECLARED);
  });

  it("permite iniciar con la salida ya pasada", async () => {
    const trip = await tripRepo.create(tripInput({ departureAt: new Date(Date.now() - 2 * DAY_MS) }));
    await attachAcceptedPackage(app.db, trip);

    const res = await start(trip.id, trip.carrierId);

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe(TripStatus.ACTIVE);
  });

  it.each([ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.ASSIGNED_UNFUNDED])(
    "responde 409 TRIP_PACKAGES_NOT_READY si el único paquete está %s y el viaje sigue declared",
    async (status) => {
      const trip = await tripRepo.create(tripInput());
      await attachAcceptedPackage(app.db, trip, status);

      const res = await start(trip.id, trip.carrierId);

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("TRIP_PACKAGES_NOT_READY");
      expect((await tripRepo.findById(trip.id))?.status).toBe(TripStatus.DECLARED);
    },
  );

  it("responde 409 TRIP_NO_PACKAGES si el viaje no tiene paquetes aceptados", async () => {
    const trip = await tripRepo.create(tripInput());

    const res = await start(trip.id, trip.carrierId);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TRIP_NO_PACKAGES");
  });

  it("viaje mixto: inicia, /trips expone executablePackagesCount y la ruta tiene una parada por cada paquete ejecutable", async () => {
    const trip = await tripRepo.create(tripInput());
    const executable = await attachAcceptedPackage(app.db, trip, ShipmentStatus.ASSIGNED);
    await attachAcceptedPackage(app.db, trip, ShipmentStatus.ASSIGNMENT_PENDING);
    const headers = { "x-user-id": trip.carrierId, "x-user-roles": "carrier" };
    profiles[trip.carrierId] = fakePublicProfile({ id: trip.carrierId, isVerified: true });

    const list = await app.inject({ method: "GET", url: "/trips", headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0]).toMatchObject({ acceptedPackagesCount: 2, executablePackagesCount: 1 });

    const detail = await app.inject({ method: "GET", url: `/trips/${trip.id}`, headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ acceptedPackagesCount: 2, executablePackagesCount: 1 });

    const res = await start(trip.id, trip.carrierId);
    expect(res.statusCode).toBe(200);

    const route = await app.inject({
      method: "GET",
      url: `/shipments/my-route?lat=-31.4201&lng=-64.1888&tripId=${trip.id}`,
      headers,
    });
    expect(route.statusCode).toBe(200);
    const stopShipmentIds = new Set(
      (route.json().stops as Array<{ shipmentId: string }>).map((stop) => stop.shipmentId),
    );
    // Invariante: cada paquete ejecutable que cuenta la card aparece en la ruta, y nada más.
    expect([...stopShipmentIds]).toEqual([executable.shipmentId]);
  });

  it("el Swagger generado documenta executablePackagesCount en GET /trips y GET /trips/:id", () => {
    const spec = app.swagger() as {
      paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: unknown }> }> }>>;
    };
    const listSchema = JSON.stringify(spec.paths["/trips/"]?.get?.responses["200"] ?? spec.paths["/trips"]?.get?.responses["200"]);
    const detailSchema = JSON.stringify(spec.paths["/trips/{id}"]?.get?.responses["200"]);
    expect(listSchema).toContain("executablePackagesCount");
    expect(detailSchema).toContain("executablePackagesCount");
  });
});
