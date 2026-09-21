import Fastify, { FastifyInstance } from "fastify";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import errorHandlerPlugin from "../src/plugins/error-handler";
import tripsRoutes from "../src/modules/trips/trips.routes";
import { TripsService } from "../src/modules/trips/trips.service";
import { ApiError, TripStatus } from "@movo/shared";

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
      startTrip: vi.fn().mockResolvedValue(mockTrip({ status: TripStatus.ACTIVE })),
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

  it("POST /:id/start inicia el viaje y devuelve 200 con status active (MOVO-221)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/${TRIP_ID}/start`,
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe(TripStatus.ACTIVE);
    expect(service.startTrip).toHaveBeenCalledWith({
      tripId: TRIP_ID,
      callerId: CARRIER_ID,
      callerRoles: ["carrier"],
    });
  });

  it("POST /:id/start responde 409 TRIP_ALREADY_HAS_ACTIVE_TRIP si ya hay otro viaje active", async () => {
    (service.startTrip as any).mockRejectedValue(
      new ApiError(409, "TRIP_ALREADY_HAS_ACTIVE_TRIP", "Ya tenés otro viaje activo"),
    );

    const res = await app.inject({
      method: "POST",
      url: `/${TRIP_ID}/start`,
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TRIP_ALREADY_HAS_ACTIVE_TRIP");
  });

  it("POST /:id/start responde 409 TRIP_NOT_DECLARED si el viaje ya no está declared", async () => {
    (service.startTrip as any).mockRejectedValue(
      new ApiError(409, "TRIP_NOT_DECLARED", "El viaje no está declared"),
    );

    const res = await app.inject({
      method: "POST",
      url: `/${TRIP_ID}/start`,
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TRIP_NOT_DECLARED");
  });

  it("POST /:id/start responde 403 AUTH_FORBIDDEN si el caller no es el dueño", async () => {
    (service.startTrip as any).mockRejectedValue(
      new ApiError(403, "AUTH_FORBIDDEN", "No tenés permiso"),
    );

    const res = await app.inject({
      method: "POST",
      url: `/${TRIP_ID}/start`,
      headers: {
        "x-user-id": "99999999-9999-9999-9999-999999999999",
        "x-user-roles": "carrier",
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it("POST /:id/start responde 404 TRIP_NOT_FOUND si el viaje no existe", async () => {
    (service.startTrip as any).mockRejectedValue(
      new ApiError(404, "TRIP_NOT_FOUND", "No existe"),
    );

    const res = await app.inject({
      method: "POST",
      url: `/${TRIP_ID}/start`,
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
    });

    expect(res.statusCode).toBe(404);
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
      detourDistanceKm: 7.5,
      detourDurationMinutes: 12,
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
    expect(body.items[0].detourDistanceKm).toBe(7.5);
    expect(body.items[0].detourDurationMinutes).toBe(12);
    expect(body.items[0].pickupDate).toBe("2030-01-01");
    expect(body.items[0].pickupTimeWindowStart).toBe("09:00:00");
    expect(body.items[0].pickupTimeWindowEnd).toBe("12:00:00");
  });

  it("GET /:id/matches propaga 502 ante falla del servicio de ruteo (No-Fallback)", async () => {
    (service.getTripMatches as any).mockRejectedValue(
      new ApiError(502, "ROUTING_SERVICE_ERROR", "Falla en servicio de ruteo")
    );

    const res = await app.inject({
      method: "GET",
      url: `/${TRIP_ID}/matches?radiusKm=20`,
      headers: {
        "x-user-id": CARRIER_ID,
        "x-user-roles": "carrier",
      },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error.code).toBe("ROUTING_SERVICE_ERROR");
  });
});
