import { createMockRoutesProvider } from "./mock-routes-provider";
import { createGoogleRoutesProvider } from "./google-routes-provider";

export interface RouteLatLng {
  lat: number;
  lng: number;
}

export interface RouteInput {
  origin: RouteLatLng;
  destination: RouteLatLng;
}

export interface RouteResult {
  /** Polyline codificado (algoritmo estándar de Google, 5 decimales de precisión) —
   * el cliente lo decodifica con el mismo algoritmo, sea la ruta real o simulada. */
  polyline: string;
  distanceMeters: number;
  durationSeconds: number;
}

/** Interfaz detrás de la que vive la ruta real por calle del mapa del wizard de envíos
 * (MOVO-123, mapa de resumen de MOVO-83) — mismo criterio que `GeocodingProvider`
 * (ADR-014, `movo-svc-users`): permite testear `shipments.routes.ts` sin red y cambiar
 * de implementación (real/mock) sin tocar el resto del servicio. */
export interface RoutesProvider {
  getRoute(input: RouteInput): Promise<RouteResult>;
}

export interface RoutesProviderConfig {
  ROUTES_PROVIDER: "mock" | "google";
  GOOGLE_MAPS_API_KEY?: string;
}

/**
 * Selecciona la implementación según `ROUTES_PROVIDER` (default "mock" — mismo
 * criterio que `GEOCODING_PROVIDER=mock`/`SMS_PROVIDER=console`/`DIDIT_MODE=mock`): no
 * depender de una API key de Google para levantar el servicio en dev/test/CI. Falla
 * rápido al arrancar si se pide "google" sin la key.
 */
export function createRoutesProvider(config: RoutesProviderConfig): RoutesProvider {
  if (config.ROUTES_PROVIDER === "google") {
    if (!config.GOOGLE_MAPS_API_KEY) {
      throw new Error("ROUTES_PROVIDER=google requiere GOOGLE_MAPS_API_KEY");
    }
    return createGoogleRoutesProvider({ apiKey: config.GOOGLE_MAPS_API_KEY });
  }
  return createMockRoutesProvider();
}
