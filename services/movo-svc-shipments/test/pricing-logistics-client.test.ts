import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createPricingLogisticsClient,
  EvaluateCandidatesInput,
  EvaluateCandidatesResult,
} from "../src/adapters/pricing-logistics-client";

describe("PricingLogisticsClient (MOVO-219)", () => {
  const BASE_URL = "http://pricing-service:8000";
  const client = createPricingLogisticsClient({ PRICING_SERVICE_URL: BASE_URL, timeoutMs: 1000 });

  const sampleInput: EvaluateCandidatesInput = {
    trip: {
      id: "trip-123",
      originLat: -31.4201,
      originLng: -64.1888,
      destinationLat: -32.4075,
      destinationLng: -63.2402,
      departureAt: "2026-09-15T10:00:00.000Z",
    },
    candidates: [
      {
        id: "shipment-1",
        pickupLat: -31.65,
        pickupLng: -63.91,
        dropoffLat: -32.04,
        dropoffLng: -63.57,
      },
    ],
  };

  const sampleResult: EvaluateCandidatesResult = {
    directDistanceKm: 145.2,
    directDurationMinutes: 110,
    evaluations: [
      {
        candidateId: "shipment-1",
        feasible: true,
        detourDistanceKm: 8.5,
        detourDurationMinutes: 15,
        totalDistanceKm: 153.7,
        totalDurationMinutes: 125,
      },
    ],
    calculationMethod: "haversine_vrptw_v1",
  };

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("llama a POST /routes/evaluate-candidates con body y headers correctos", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleResult,
    } as Response);

    const result = await client.evaluateCandidates(sampleInput);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BASE_URL}/routes/evaluate-candidates`,
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sampleInput),
      })
    );
    expect(result).toEqual(sampleResult);
  });

  it("lanza ApiError 503 ROUTING_SERVICE_UNAVAILABLE ante TimeoutError", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    globalThis.fetch = vi.fn().mockRejectedValue(timeoutError);

    await expect(client.evaluateCandidates(sampleInput)).rejects.toMatchObject({
      statusCode: 503,
      code: "ROUTING_SERVICE_UNAVAILABLE",
    });
  });

  it("lanza ApiError 503 ROUTING_SERVICE_UNAVAILABLE ante error de conexión", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    await expect(client.evaluateCandidates(sampleInput)).rejects.toMatchObject({
      statusCode: 503,
      code: "ROUTING_SERVICE_UNAVAILABLE",
    });
  });

  it("lanza ApiError 503 ROUTING_SERVICE_UNAVAILABLE si el servicio responde 503", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    await expect(client.evaluateCandidates(sampleInput)).rejects.toMatchObject({
      statusCode: 503,
      code: "ROUTING_SERVICE_UNAVAILABLE",
    });
  });

  it("lanza ApiError 502 ROUTING_SERVICE_ERROR ante error HTTP 500 / 502 (No-Fallback)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
    } as Response);

    await expect(client.evaluateCandidates(sampleInput)).rejects.toMatchObject({
      statusCode: 502,
      code: "ROUTING_SERVICE_ERROR",
    });
  });
});
