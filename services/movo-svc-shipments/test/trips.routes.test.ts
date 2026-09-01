import Fastify, { FastifyInstance } from "fastify";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import errorHandlerPlugin from "../src/plugins/error-handler";
import tripsRoutes from "../src/modules/trips/trips.routes";
import { TripsService } from "../src/modules/trips/trips.service";
import { TripStatus } from "@movo/shared";

const CARRIER_ID = "11111111-1111-1111-1111-111111111111";
const TRIP_ID = "22222222-2222-2222-2222-222222222222";

function mockTrip(overrides: Record<string, any> = {}) {
  return {
    id: TRIP_ID,
    carrierId: CARRIER_ID,
    originAddress: "Córdoba",
    originLat: -31.4201,
    originLng: -64.1888,
    destinationAddress: "Villa María",
    destinationLat: -32.4075,
    destinationLng: -63.2402,
    departureAt: new Date("2030-01-01T14:00:00.000Z"),
    vehicleType: "auto",
    status: TripStatus.ACTIVE,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    hasAcceptedPackages: false,
    ...overrides,
  };
}

describe("trips.routes (Fastify HTTP endpoints)", () => {
  let app: FastifyInstance;
  let service: TripsService;

  beforeEach(async () => {
    service = {
      createTrip: vi.fn().mockResolvedValue(mockTrip()),
      getTrip: vi.fn().mockResolvedValue(mockTrip()),
      listCarrierTrips: vi.fn().mockResolvedValue({
        items: [mockTrip()],
        total: 1,
        page: 1,
        limit: 20,
      }),
      updateTrip: vi.fn().mockResolvedValue(mockTrip({ vehicleType: "camioneta" })),
      deleteTrip: vi.fn().mockResolvedValue(undefined),
      getTripMatches: vi.fn().mockImplementation(async (params) => ({
        items: [],
        total: 0,
        page: params.page,
        limit: params.limit,
        tripId: params.tripId,
        radiusKm: params.radiusKm ?? 15,
      })),
    };

    app = Fastify({ logger: false });
    (app as any).config = { TRIP_DEFAULT_MAX_DETOUR_KM: 15 };
    await app.register(errorHandlerPlugin);
    await app.register(tripsRoutes, { service });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST / declara un viaje y responde 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
      payload: {
        originAddress: "Córdoba",
        originLat: -31.4201,
        originLng: -64.1888,
        destinationAddress: "Villa María",
        destinationLat: -32.4075,
        destinationLng: -63.2402,
        departureAt: "2030-01-01T14:00:00.000Z",
        vehicleType: "auto",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe(TRIP_ID);
    expect(body.departureAt).toBe("2030-01-01T14:00:00.000Z");
    expect(service.createTrip).toHaveBeenCalled();
  });

  it("POST / responde 400 VALIDATION_FAILED ante body inválido", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
      payload: {
        originAddress: "", // inválido por minLength: 1
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("GET / lista los viajes del transportista", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/?page=1&limit=10",
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.items[0].hasAcceptedPackages).toBe(false);
  });

  it("GET /:id devuelve el detalle del viaje", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/${TRIP_ID}`,
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(TRIP_ID);
    expect(body.hasAcceptedPackages).toBe(false);
  });

  it("PATCH /:id edita el viaje y devuelve 200", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/${TRIP_ID}`,
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
      payload: {
        vehicleType: "camioneta",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().vehicleType).toBe("camioneta");
    expect(service.updateTrip).toHaveBeenCalled();
  });

  it("DELETE /:id elimina el viaje y devuelve 204", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/${TRIP_ID}`,
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
    });

    expect(res.statusCode).toBe(204);
    expect(service.deleteTrip).toHaveBeenCalled();
  });

  it("GET /:id/matches devuelve paquetes compatibles con el corredor", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/${TRIP_ID}/matches?radiusKm=20`,
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tripId).toBe(TRIP_ID);
    expect(body.radiusKm).toBe(20);
    expect(service.getTripMatches).toHaveBeenCalledWith({
      tripId: TRIP_ID,
      callerId: CARRIER_ID,
      callerRoles: ["carrier"],
      radiusKm: 20,
      page: 1,
      limit: 20,
    });
  });

  it("GET /:id/matches serializa ítems con hasMyOffer y formatea fechas", async () => {
    const mockAvailableItem = {
      id: "33333333-3333-3333-3333-333333333333",
      packageType: "caja",
      weightKg: 2.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      description: "Documentos",
      urgent: false,
      pickupAddress: "Córdoba",
      pickupLat: -31.42,
      pickupLng: -64.18,
      deliveryAddress: "Villa María",
      deliveryLat: -32.4,
      deliveryLng: -63.24,
      pickupDate: new Date("2030-01-01T00:00:00.000Z"),
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 2500,
      status: "pending_carrier",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      distanceKm: 140,
      pickupDistanceKm: 1.2,
      deliveryDistanceKm: 2.5,
      hasMyOffer: true,
    };

    (service.getTripMatches as any).mockResolvedValue({
      items: [mockAvailableItem],
      total: 1,
      page: 1,
      limit: 20,
      tripId: TRIP_ID,
      radiusKm: 20,
    });

    const res = await app.inject({
      method: "GET",
      url: `/${TRIP_ID}/matches?radiusKm=20`,
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("33333333-3333-3333-3333-333333333333");
    expect(body.items[0].hasMyOffer).toBe(true);
    expect(body.items[0].pickupDate).toBe("2030-01-01");
    expect(body.items[0].pickupTimeWindowStart).toBe("09:00:00");
    expect(body.items[0].pickupTimeWindowEnd).toBe("12:00:00");
  });
});
