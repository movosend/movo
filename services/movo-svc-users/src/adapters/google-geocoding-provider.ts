import { ApiError } from "@movo/shared";
import { googleErrorDetail, ProviderLogger, readGoogleErrorDetail } from "./google-error";
import { GeocodeAddressInput, GeocodeResult, GeocodingProvider, ReverseGeocodeResult } from "./geocoding-provider";

export interface GoogleGeocodingProviderConfig {
  apiKey: string;
  baseUrl?: string;
  /** Para dejar en el log por qué Google rechazó el pedido (key, facturación, API sin habilitar). */
  log?: ProviderLogger | undefined;
}

const DEFAULT_BASE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
    address_components?: Array<{ long_name: string; types: string[] }>;
  }>;
}

/** MOVO-325: la localidad del primer resultado; sin `locality`, el departamento (`administrative_area_level_2`). */
function extractCity(components: Array<{ long_name: string; types: string[] }> | undefined): string | null {
  if (!components) return null;
  for (const type of ["locality", "administrative_area_level_2"]) {
    const found = components.find((component) => component.types.includes(type));
    if (found) return found.long_name;
  }
  return null;
}

/**
 * La Geocoding API responde 200 también cuando rechaza el pedido (`REQUEST_DENIED` por
 * key o facturación, `OVER_QUERY_LIMIT`, `UNKNOWN_ERROR`): solo `ZERO_RESULTS` significa
 * que la dirección no existe. Antes cualquier status distinto de `OK` salía como 422
 * "no pudimos ubicar", y una key sin facturación parecía un dato mal cargado.
 */
async function parseGeocodeResponse(
  response: Response,
  op: "geocode" | "reverse",
  log: ProviderLogger | undefined,
  notFoundMessage: string,
): Promise<GoogleGeocodeResponse["results"][number]> {
  if (!response.ok) {
    log?.warn({ google: await readGoogleErrorDetail(response), op }, "google_geocoding_error");
    throw new ApiError(502, "GEOCODING_PROVIDER_ERROR", "El proveedor de geocoding devolvió un error.");
  }
  const body = (await response.json()) as GoogleGeocodeResponse;
  const first = body.results?.[0];
  if (body.status === "OK" && first) return first;
  if (body.status === "OK" || body.status === "ZERO_RESULTS") {
    throw new ApiError(422, "GEOCODING_ADDRESS_NOT_FOUND", notFoundMessage);
  }
  log?.warn({ google: googleErrorDetail(response.status, body), op }, "google_geocoding_error");
  throw new ApiError(502, "GEOCODING_PROVIDER_ERROR", "El proveedor de geocoding devolvió un error.");
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

      const first = await parseGeocodeResponse(
        response,
        "geocode",
        config.log,
        "No pudimos ubicar esa dirección en el mapa.",
      );

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

      const first = await parseGeocodeResponse(
        response,
        "reverse",
        config.log,
        "No pudimos ubicar una dirección para esa posición.",
      );

      return { formattedAddress: first.formatted_address, city: extractCity(first.address_components) };
    },
  };
}
