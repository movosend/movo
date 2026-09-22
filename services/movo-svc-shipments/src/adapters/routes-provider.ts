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

export interface RouteMatrixInput {
  origin: RouteLatLng;
  destinations: RouteLatLng[];
}

export interface RouteDurationResult {
  /** Índice del destino dentro de `RouteMatrixInput.destinations` -- el resultado
   * viaja en el mismo orden que se pidió, pero se etiqueta explícito para no depender
   * de que ningún transporte intermedio reordene el array. */
  destinationIndex: number;
  /** `null` si Google no pudo trazar una ruta a ese destino puntual (`condition` !=
   * `ROUTE_EXISTS`) -- un destino sin ruta no tira el resto de la matriz abajo. */
  durationSeconds: number | null;
}

/** Interfaz detrás de la que vive la ruta real por calle del mapa del wizard de envíos
 * (MOVO-123, mapa de resumen de MOVO-83) — mismo criterio que `GeocodingProvider`
 * (ADR-014, `movo-svc-users`): permite testear `shipments.routes.ts` sin red y cambiar
 * de implementación (real/mock) sin tocar el resto del servicio. */
export interface RoutesProvider {
  getRoute(input: RouteInput): Promise<RouteResult>;
  /**
   * Variante uno-a-muchos para cuando varios destinos comparten el mismo origen (ej.
   * notificar a cada envío pendiente de un viaje recién iniciado, `trips.service.ts`) —
   * una sola llamada facturable (`Compute Route Matrix`, ADR-015/ADR-008) en vez de N
   * `getRoute` por separado (hallazgo de code review de PR #182/MOVO-245: N envíos
   * pendientes en el mismo viaje disparaban N llamadas billables con el mismo origen).
   * Solo duración -- ningún caller de esta variante necesita el polyline por destino.
   */
  getRouteDurations(input: RouteMatrixInput): Promise<RouteDurationResult[]>;
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
