import { ApiError } from "@movo/shared";
import { GeocodeAddressInput, GeocodeResult, GeocodingProvider, ReverseGeocodeResult } from "./geocoding-provider";

export interface GoogleGeocodingProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

interface GoogleGeocodeResponse {
  status: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
}

function buildAddressLine(input: GeocodeAddressInput): string {
  const line1 = input.floor ? `${input.street} ${input.number} piso ${input.floor}` : `${input.street} ${input.number}`;
  return `${line1}, ${input.city}, ${input.province}, ${input.zip}, Argentina`;
}

/**
 * Implementación real de `GeocodingProvider` sobre la Geocoding API de Google (AC del
 * paso de mapa, MOVO-73) — proxeada server-side a propósito: esta API key (a
 * diferencia de la key de renderizado del mapa en el mobile) no tiene restricción de
 * bundle/paquete, solo de IP, así que no puede viajar embebida en el cliente.
 */
export function createGoogleGeocodingProvider(config: GoogleGeocodingProviderConfig): GeocodingProvider {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  return {
    async geocode(input: GeocodeAddressInput): Promise<GeocodeResult> {
      const url = new URL(baseUrl);
      url.searchParams.set("address", buildAddressLine(input));
      url.searchParams.set("key", config.apiKey);

      let response: Response;
      try {
        response = await fetch(url.toString());
      } catch {
        throw new ApiError(502, "GEOCODING_PROVIDER_ERROR", "No se pudo conectar con el proveedor de geocoding.");
      }

      if (!response.ok) {
        throw new ApiError(502, "GEOCODING_PROVIDER_ERROR", "El proveedor de geocoding devolvió un error.");
      }

      const body = (await response.json()) as GoogleGeocodeResponse;
      const first = body.results[0];
      if (body.status !== "OK" || !first) {
        throw new ApiError(422, "GEOCODING_ADDRESS_NOT_FOUND", "No pudimos ubicar esa dirección en el mapa.");
      }

      return {
        lat: first.geometry.location.lat,
        long: first.geometry.location.lng,
        formattedAddress: first.formatted_address,
      };
    },

    // MOVO-125: mismo endpoint que `geocode()`, con `latlng=` en vez de `address=` —
    // es el mismo recurso de la Geocoding API resolviendo el sentido inverso, no una
    // API distinta (a diferencia de Places, que no toma coordenadas crudas).
    async reverseGeocode(lat: number, long: number): Promise<ReverseGeocodeResult> {
      const url = new URL(baseUrl);
      url.searchParams.set("latlng", `${lat},${long}`);
      url.searchParams.set("key", config.apiKey);

      let response: Response;
      try {
        response = await fetch(url.toString());
      } catch {
        throw new ApiError(502, "GEOCODING_PROVIDER_ERROR", "No se pudo conectar con el proveedor de geocoding.");
      }

      if (!response.ok) {
        throw new ApiError(502, "GEOCODING_PROVIDER_ERROR", "El proveedor de geocoding devolvió un error.");
      }

      const body = (await response.json()) as GoogleGeocodeResponse;
      const first = body.results[0];
      if (body.status !== "OK" || !first) {
        throw new ApiError(422, "GEOCODING_ADDRESS_NOT_FOUND", "No pudimos ubicar una dirección para esa posición.");
      }

      return { formattedAddress: first.formatted_address };
    },
  };
}
