import { createMockPlacesProvider } from "./mock-places-provider";
import { createGooglePlacesProvider } from "./google-places-provider";

export interface PlacePrediction {
  placeId: string;
  description: string;
}

export interface PlaceDetails {
  formattedAddress: string;
  lat: number;
  long: number;
}

/** Interfaz detrás de la que vive la integración de Google Places (New) para el paso
 * de direcciones del wizard de envío (MOVO-83, estilo Uber/Pedidos Ya: un campo de
 * texto libre con sugerencias, en vez del formulario estructurado calle/número/piso/
 * ciudad/provincia/CP que usaba el geocoding de MOVO-73) — mismo criterio que
 * `GeocodingProvider`/`SmsProvider`/`DiditClient`: testear las rutas sin red y poder
 * cambiar de implementación sin tocar el resto del servicio. */
export interface PlacesProvider {
  autocomplete(input: string): Promise<PlacePrediction[]>;
  details(placeId: string): Promise<PlaceDetails>;
}

export interface PlacesProviderConfig {
  PLACES_PROVIDER: "mock" | "google";
  GOOGLE_MAPS_API_KEY?: string;
}

/**
 * Selecciona la implementación según `PLACES_PROVIDER` (default "mock" — mismo
 * criterio que `GEOCODING_PROVIDER=mock`/`SMS_PROVIDER=console`): no depender de una
 * API key de Google para levantar el servicio en dev/test/CI. Reusa la MISMA
 * `GOOGLE_MAPS_API_KEY` que ya usa `GeocodingProvider` (mismo proyecto de Google
 * Cloud) — para que `PLACES_PROVIDER=google` funcione de verdad hace falta habilitar
 * la Places API (New) sobre esa key en la consola de Google Cloud, algo que todavía no
 * se hizo (mismo estado "credencial pendiente de cargar" que Twilio/Didit, ver
 * CLAUDE.md). Falla rápido al arrancar si se pide "google" sin la key.
 */
export function createPlacesProvider(config: PlacesProviderConfig): PlacesProvider {
  if (config.PLACES_PROVIDER === "google") {
    if (!config.GOOGLE_MAPS_API_KEY) {
      throw new Error("PLACES_PROVIDER=google requiere GOOGLE_MAPS_API_KEY");
    }
    return createGooglePlacesProvider({ apiKey: config.GOOGLE_MAPS_API_KEY });
  }
  return createMockPlacesProvider();
}
