import { createMockGeocodingProvider } from "./mock-geocoding-provider";
import { createGoogleGeocodingProvider } from "./google-geocoding-provider";

/** Dirección tal como la carga el usuario en el wizard de registro (MOVO-73), antes
 * de confirmar el pin en el paso de mapa. */
export interface GeocodeAddressInput {
  street: string;
  number: string;
  floor?: string;
  city: string;
  province: string;
  zip: string;
}

export interface GeocodeResult {
  lat: number;
  long: number;
  formattedAddress: string;
}

/** Interfaz detrás de la que vive la integración de geocoding (MOVO-73), mismo
 * criterio que `SmsProvider` (ADR-012) y `DiditClient` (MOVO-72): permite testear
 * `geocode.routes.ts` sin red y cambiar de implementación (real/mock) sin tocar el
 * resto del servicio. */
export interface GeocodingProvider {
  geocode(input: GeocodeAddressInput): Promise<GeocodeResult>;
}

export interface GeocodingProviderConfig {
  GEOCODING_PROVIDER: "mock" | "google";
  GOOGLE_MAPS_API_KEY?: string;
}

/**
 * Selecciona la implementación según `GEOCODING_PROVIDER` (default "mock" — mismo
 * criterio que `SMS_PROVIDER=console`/`DIDIT_MODE=mock`): no depender de una API key
 * de Google para levantar el servicio en dev/test/CI. Falla rápido al arrancar si se
 * pide "google" sin la key.
 */
export function createGeocodingProvider(config: GeocodingProviderConfig): GeocodingProvider {
  if (config.GEOCODING_PROVIDER === "google") {
    if (!config.GOOGLE_MAPS_API_KEY) {
      throw new Error("GEOCODING_PROVIDER=google requiere GOOGLE_MAPS_API_KEY");
    }
    return createGoogleGeocodingProvider({ apiKey: config.GOOGLE_MAPS_API_KEY });
  }
  return createMockGeocodingProvider();
}
