import Fastify, { FastifyInstance } from "fastify";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import errorHandlerPlugin from "../src/plugins/error-handler";
import shipmentsRoutes from "../src/modules/shipments/shipments.routes";
import { ShipmentsService } from "../src/modules/shipments/shipments.service";
import { CarrierRoute } from "@movo/shared";

const CARRIER_ID = "11111111-1111-1111-1111-111111111111";

describe("GET /shipments/my-route (HTTP Routes & ACs)", () => {
  let app: FastifyInstance;
  let mockService: Partial<ShipmentsService>;

  const sampleRoute: CarrierRoute = {
    stops: [
      {
        stopOrder: 1,
        shipmentId: "22222222-2222-2222-2222-222222222222",
        type: "pickup",
        address: "Av. Colón 100",
        lat: -31.4167,
        lng: -64.1833,
        timeWindowStart: "2026-09-15T12:00:00.000Z",
        timeWindowEnd: "2026-09-15T15:00:00.000Z",
        estimatedArrivalMinutes: 5.0,
        estimatedArrivalAt: "2026-09-15T12:05:00.000Z",
        estimatedDepartureAt: "2026-09-15T12:15:00.000Z",
        outsideTimeWindow: false,
      },
    ],
    totalDistanceKm: 5.2,
    totalDurationMinutes: 15.0,
    optimized: true,
    disclaimer: "Estimación geométrica",
  };

  beforeEach(async () => {
    mockService = {
      getMyRoute: vi.fn().mockResolvedValue(sampleRoute),
    };

    app = Fastify({ logger: false });
    (app as any).config = {
      RECEIVER_CONFIRMATION_TIMEOUT_HOURS: 48,
      REPUTATION_CONFIDENCE_CONSTANT: 5,
      REPUTATION_DECAY_HALF_LIFE_DAYS: 30,
    };
    await app.register(errorHandlerPlugin);
    await app.register(shipmentsRoutes, {
      prefix: "/shipments",
      service: mockService as any,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("rechaza sin header x-user-id con 401 AUTH_REQUIRED", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/shipments/my-route?lat=-31.4167&lng=-64.1833",
    });

    expect(res.statusCode).toBe(401);
    expect(mockService.getMyRoute).not.toHaveBeenCalled();
  });

  it("rechaza sin coordenadas lat/lng con 400 VALIDATION_FAILED", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/shipments/my-route",
      headers: { "x-user-id": CARRIER_ID },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rechaza latitud inválida (> 90) con 400 VALIDATION_FAILED", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/shipments/my-route?lat=100&lng=-64.1833",
      headers: { "x-user-id": CARRIER_ID },
    });

    expect(res.statusCode).toBe(400);
  });

  it("AC8: Devuelve 200 y llama a getMyRoute con el caller autenticado", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/shipments/my-route?lat=-31.4167&lng=-64.1833",
      headers: { "x-user-id": CARRIER_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(mockService.getMyRoute).toHaveBeenCalledWith(CARRIER_ID, {
      lat: -31.4167,
      lng: -64.1833,
    });
    const body = JSON.parse(res.body);
    expect(body).toEqual(sampleRoute);
  });

  it("AC8: Si se envía un carrierId por query, se ignora y se usa el del header x-user-id", async () => {
    const attackerId = "99999999-9999-9999-9999-999999999999";
    const res = await app.inject({
      method: "GET",
      url: `/shipments/my-route?lat=-31.4167&lng=-64.1833&carrierId=${attackerId}`,
      headers: { "x-user-id": CARRIER_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(mockService.getMyRoute).toHaveBeenCalledWith(CARRIER_ID, {
      lat: -31.4167,
      lng: -64.1833,
    });
  });
});
