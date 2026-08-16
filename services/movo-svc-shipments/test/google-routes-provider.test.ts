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
});
