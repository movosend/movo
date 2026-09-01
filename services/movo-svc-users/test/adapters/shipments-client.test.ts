import { describe, it, expect, vi, beforeEach } from "vitest";
import { createShipmentsClient } from "../../src/adapters/shipments-client";

// Mismo criterio que http-didit-client.test.ts/twilio-sms-provider.test.ts: se
// mockea fetch en vez de depender de un movo-svc-shipments real levantado.
const fetchMock = vi.fn();

describe("ShipmentsClient (adapter concreto)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  const client = createShipmentsClient({ SHIPMENTS_SERVICE_URL: "http://svc-shipments.test" });

  describe("hasActiveShipments", () => {
    it("pega GET a /internal/account-deletion/users/:id/active-shipments y devuelve el body", async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ hasActiveDispute: false, hasActiveShipments: true }) });

      const result = await client.hasActiveShipments("user-1");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://svc-shipments.test/internal/account-deletion/users/user-1/active-shipments");
      expect(init.method).toBe("GET");
      expect(result).toEqual({ hasActiveDispute: false, hasActiveShipments: true });
    });

    it("lanza ApiError 502 SHIPMENTS_SERVICE_UNAVAILABLE ante una respuesta no-ok", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      await expect(client.hasActiveShipments("user-1")).rejects.toMatchObject({
        statusCode: 502,
        code: "SHIPMENTS_SERVICE_UNAVAILABLE",
      });
    });

    it("lanza ApiError 502 ante un fallo de red/timeout", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));

      await expect(client.hasActiveShipments("user-1")).rejects.toMatchObject({
        statusCode: 502,
        code: "SHIPMENTS_SERVICE_UNAVAILABLE",
      });
    });
  });

  describe("findReputation (MOVO-152)", () => {
    it("pega GET a /internal/users/:id/reputation y devuelve el agregado", async () => {
      const summary = {
        reputationScore: 4.5,
        ratingCount: 8,
        isNewProfile: false,
        asSender: { reputationScore: 4.3, ratingCount: 3, isNewProfile: false },
        asCarrier: { reputationScore: 4.6, ratingCount: 5, isNewProfile: false },
        transactionCounts: { asSender: 3, asCarrier: 5 },
      };
      fetchMock.mockResolvedValue({ ok: true, json: async () => summary });

      const result = await client.findReputation("user-1");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://svc-shipments.test/internal/users/user-1/reputation");
      expect(init.method).toBe("GET");
      expect(result).toEqual(summary);
    });

    it("lanza (nunca devuelve un fallback) ante una respuesta no-ok -- el caller decide qué hacer", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503 });

      await expect(client.findReputation("user-1")).rejects.toThrow(/503/);
    });

    it("propaga un fallo de red/timeout (AbortSignal.timeout) sin capturarlo", async () => {
      fetchMock.mockRejectedValue(new Error("timeout"));

      await expect(client.findReputation("user-1")).rejects.toThrow("timeout");
    });

    it("encodea el userId en la URL", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          reputationScore: null,
          ratingCount: 0,
          isNewProfile: true,
          asSender: { reputationScore: null, ratingCount: 0, isNewProfile: true },
          asCarrier: { reputationScore: null, ratingCount: 0, isNewProfile: true },
          transactionCounts: { asSender: 0, asCarrier: 0 },
        }),
      });

      await client.findReputation("user with spaces");

      expect(fetchMock.mock.calls[0][0]).toBe(
        "http://svc-shipments.test/internal/users/user%20with%20spaces/reputation"
      );
    });
  });

  describe("findRecentRatingComments (MOVO-152 AC2)", () => {
    it("pega GET a /internal/users/:id/ratings/recent?limit= y mapea solo los campos del contrato", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: "rating-1",
            shipmentId: "shipment-1",
            raterId: "rater-1",
            rateeId: "user-1",
            role: "sender",
            score: 5,
            comment: "Todo perfecto",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      });

      const result = await client.findRecentRatingComments("user-1", 10);

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("http://svc-shipments.test/internal/users/user-1/ratings/recent?limit=10");
      expect(result).toEqual([
        { id: "rating-1", raterId: "rater-1", score: 5, comment: "Todo perfecto", createdAt: "2026-08-01T00:00:00.000Z" },
      ]);
      // Nunca filtra shipmentId/rateeId/role -- confirma que el mapeo los descarta.
      expect(result[0]).not.toHaveProperty("shipmentId");
      expect(result[0]).not.toHaveProperty("role");
    });

    it("devuelve [] pasa a través solo si el body ya viene vacío -- no swallowea errores", async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => [] });

      const result = await client.findRecentRatingComments("user-1", 10);

      expect(result).toEqual([]);
    });

    it("lanza ante una respuesta no-ok, mismo criterio que findReputation", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      await expect(client.findRecentRatingComments("user-1", 10)).rejects.toThrow(/500/);
    });
  });
});
