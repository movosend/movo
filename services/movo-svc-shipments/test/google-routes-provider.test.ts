import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError } from "@movo/shared";
import { createGoogleRoutesProvider } from "../src/adapters/google-routes-provider";

const origin = { lat: -31.4201, lng: -64.1888 };
const destination = { lat: -31.4135, lng: -64.1811 };

describe("createGoogleRoutesProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mapea la respuesta de Compute Routes a RouteResult", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          routes: [{ distanceMeters: 1500, duration: "240s", polyline: { encodedPolyline: "abc123" } }],
        }),
      }),
    );

    const provider = createGoogleRoutesProvider({ apiKey: "test-key" });
    const result = await provider.getRoute({ origin, destination });

    expect(result).toEqual({ polyline: "abc123", distanceMeters: 1500, durationSeconds: 240 });
  });

  it("manda la API key y el field mask como headers, nunca en el body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distanceMeters: 1, duration: "1s", polyline: { encodedPolyline: "x" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createGoogleRoutesProvider({ apiKey: "secret-key" }).getRoute({ origin, destination });

    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit.headers["X-Goog-Api-Key"]).toBe("secret-key");
    expect(requestInit.headers["X-Goog-FieldMask"]).toContain("polyline.encodedPolyline");
    expect(requestInit.body).not.toContain("secret-key");
  });

  it("traduce una falla de red a ApiError 502 ROUTES_PROVIDER_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    const provider = createGoogleRoutesProvider({ apiKey: "test-key" });
    await expect(provider.getRoute({ origin, destination })).rejects.toMatchObject({
      statusCode: 502,
      code: "ROUTES_PROVIDER_ERROR",
    } satisfies Partial<ApiError>);
  });

  it("traduce una respuesta sin rutas a ApiError 422 ROUTE_NOT_FOUND", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [] }) }),
    );

    const provider = createGoogleRoutesProvider({ apiKey: "test-key" });
    await expect(provider.getRoute({ origin, destination })).rejects.toMatchObject({
      statusCode: 422,
      code: "ROUTE_NOT_FOUND",
    } satisfies Partial<ApiError>);
  });

  describe("getRouteDurations", () => {
    const destinationB = { lat: -31.5, lng: -64.3 };

    it("manda un origen y N destinos en una sola llamada a Compute Route Matrix", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { originIndex: 0, destinationIndex: 0, condition: "ROUTE_EXISTS", duration: "300s" },
          { originIndex: 0, destinationIndex: 1, condition: "ROUTE_EXISTS", duration: "900s" },
        ],
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider = createGoogleRoutesProvider({ apiKey: "test-key" });
      const results = await provider.getRouteDurations({ origin, destinations: [destination, destinationB] });

      expect(results).toEqual([
        { destinationIndex: 0, durationSeconds: 300 },
        { destinationIndex: 1, durationSeconds: 900 },
      ]);

      const [url, requestInit] = fetchMock.mock.calls[0];
      expect(url).toContain("computeRouteMatrix");
      const body = JSON.parse(requestInit.body);
      expect(body.origins).toHaveLength(1);
      expect(body.destinations).toHaveLength(2);
    });

    it("un destino sin ruta (condition != ROUTE_EXISTS) resuelve a durationSeconds: null sin tirar el resto", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [{ originIndex: 0, destinationIndex: 1, condition: "ROUTE_EXISTS", duration: "600s" }],
        }),
      );

      const provider = createGoogleRoutesProvider({ apiKey: "test-key" });
      const results = await provider.getRouteDurations({ origin, destinations: [destination, destinationB] });

      expect(results).toEqual([
        { destinationIndex: 0, durationSeconds: null },
        { destinationIndex: 1, durationSeconds: 600 },
      ]);
    });

    it("sin destinos, no llama a fetch y devuelve un array vacío", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const provider = createGoogleRoutesProvider({ apiKey: "test-key" });
      const results = await provider.getRouteDurations({ origin, destinations: [] });

      expect(results).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("traduce una falla de red a ApiError 502 ROUTES_PROVIDER_ERROR", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

      const provider = createGoogleRoutesProvider({ apiKey: "test-key" });
      await expect(provider.getRouteDurations({ origin, destinations: [destination] })).rejects.toMatchObject({
        statusCode: 502,
        code: "ROUTES_PROVIDER_ERROR",
      } satisfies Partial<ApiError>);
    });
  });
});
