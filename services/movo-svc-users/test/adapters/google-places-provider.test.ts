import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGooglePlacesProvider } from "../../src/adapters/google-places-provider";

// Mismo criterio que telegram-sms-provider.test.ts: se mockea fetch en vez de pegarle
// a la API real de Google en cada corrida de CI.
const fetchMock = vi.fn();

describe("Google Places Provider (adapter concreto, PLACES_PROVIDER=google)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("details() mapea un 404 real de Google a 404 PLACE_NOT_FOUND", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    const provider = createGooglePlacesProvider({ apiKey: "test-key" });

    await expect(provider.details("no-existe")).rejects.toMatchObject({
      statusCode: 404,
      code: "PLACE_NOT_FOUND",
    });
  });

  it("details() mapea un error de configuración (403 por API key sin habilitar) a 502 PLACES_PROVIDER_ERROR, no a PLACE_NOT_FOUND", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    const provider = createGooglePlacesProvider({ apiKey: "test-key" });

    await expect(provider.details("some-place-id")).rejects.toMatchObject({
      statusCode: 502,
      code: "PLACES_PROVIDER_ERROR",
    });
  });

  it("details() mapea un 429 (cuota excedida) a 502 PLACES_PROVIDER_ERROR", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    const provider = createGooglePlacesProvider({ apiKey: "test-key" });

    await expect(provider.details("some-place-id")).rejects.toMatchObject({
      statusCode: 502,
      code: "PLACES_PROVIDER_ERROR",
    });
  });

  it("autocomplete() reenvía sessionToken en el body cuando se pasa", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ suggestions: [] }) });

    const provider = createGooglePlacesProvider({ apiKey: "test-key" });
    await provider.autocomplete("Colón", "session-abc");

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.sessionToken).toBe("session-abc");
  });

  it("autocomplete() no manda sessionToken si no se pasa (compatibilidad hacia atrás)", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ suggestions: [] }) });

    const provider = createGooglePlacesProvider({ apiKey: "test-key" });
    await provider.autocomplete("Colón");

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.sessionToken).toBeUndefined();
  });

  it("details() agrega sessionToken como query param cuando se pasa", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ formattedAddress: "Av. Colón 1234", location: { latitude: -31.4, longitude: -64.19 } }),
    });

    const provider = createGooglePlacesProvider({ apiKey: "test-key" });
    await provider.details("mock-1", "session-abc");

    const [url] = fetchMock.mock.calls[0];
    expect((url as URL).toString()).toContain("sessionToken=session-abc");
  });
});
