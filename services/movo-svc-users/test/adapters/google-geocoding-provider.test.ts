import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGoogleGeocodingProvider } from "../../src/adapters/google-geocoding-provider";

// Mismo criterio que google-places-provider.test.ts: fetch mockeado, sin pegarle a Google.
const fetchMock = vi.fn();

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe("Google Geocoding Provider (adapter concreto, GEOCODING_PROVIDER=google)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("reverseGeocode() devuelve la dirección y la localidad del primer resultado", async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        status: "OK",
        results: [
          {
            formatted_address: "Av. Colón 500, Córdoba",
            geometry: { location: { lat: -31.41, lng: -64.19 } },
            address_components: [{ long_name: "Córdoba", types: ["locality"] }],
          },
        ],
      }),
    );

    const provider = createGoogleGeocodingProvider({ apiKey: "test-key" });

    await expect(provider.reverseGeocode(-31.41, -64.19)).resolves.toEqual({
      formattedAddress: "Av. Colón 500, Córdoba",
      city: "Córdoba",
    });
  });

  it("reverseGeocode() mapea ZERO_RESULTS a 422 GEOCODING_ADDRESS_NOT_FOUND", async () => {
    fetchMock.mockResolvedValue(okResponse({ status: "ZERO_RESULTS", results: [] }));

    const provider = createGoogleGeocodingProvider({ apiKey: "test-key" });

    await expect(provider.reverseGeocode(-31.41, -64.19)).rejects.toMatchObject({
      statusCode: 422,
      code: "GEOCODING_ADDRESS_NOT_FOUND",
    });
  });

  it("reverseGeocode() mapea REQUEST_DENIED (200 de Google, p.ej. sin facturación) a 502 y lo deja en el log", async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        status: "REQUEST_DENIED",
        error_message: "You must enable Billing on the Google Cloud Project",
        results: [],
      }),
    );
    const warn = vi.fn();

    const provider = createGoogleGeocodingProvider({ apiKey: "secret-key", log: { warn } as never });

    await expect(provider.reverseGeocode(-31.41, -64.19)).rejects.toMatchObject({
      statusCode: 502,
      code: "GEOCODING_PROVIDER_ERROR",
    });
    expect(warn).toHaveBeenCalledWith(
      {
        google: {
          httpStatus: 200,
          googleStatus: "REQUEST_DENIED",
          googleMessage: "You must enable Billing on the Google Cloud Project",
        },
        op: "reverse",
      },
      "google_geocoding_error",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-key");
  });

  it("geocode() mapea OVER_QUERY_LIMIT a 502, no a dirección inexistente", async () => {
    fetchMock.mockResolvedValue(okResponse({ status: "OVER_QUERY_LIMIT", results: [] }));

    const provider = createGoogleGeocodingProvider({ apiKey: "test-key" });

    await expect(
      provider.geocode({ street: "Colón", number: "500", city: "Córdoba", province: "Córdoba", zip: "5000" }),
    ).rejects.toMatchObject({ statusCode: 502, code: "GEOCODING_PROVIDER_ERROR" });
  });

  it("geocode() mapea un HTTP no-OK a 502 GEOCODING_PROVIDER_ERROR", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const provider = createGoogleGeocodingProvider({ apiKey: "test-key" });

    await expect(
      provider.geocode({ street: "Colón", number: "500", city: "Córdoba", province: "Córdoba", zip: "5000" }),
    ).rejects.toMatchObject({ statusCode: 502, code: "GEOCODING_PROVIDER_ERROR" });
  });
});
