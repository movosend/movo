import { ApiError } from "@movo/shared";
import { createMockRoutesProvider } from "./mock-routes-provider";
import { createGoogleRoutesProvider } from "./google-routes-provider";

export interface RouteLatLng {
  lat: number;
  lng: number;
}

/**
 * Modo de consumo de Compute Routes (MOVO-237, ADR-032):
 *
 * - `per_trip`: una llamada estática por par origen→destino (o por recálculo de
 *   paradas) para dibujar el polyline en el mapa propio de Movo — tier Basic, 1-3
 *   llamadas por viaje. Es el único modo implementado y el default.
 * - `live`: re-routing continuo tipo Waze. **Placeholder intencional, no una
 *   funcionalidad recortada por error**: la navegación real del transportista se
 *   delega por deep-link a Google Maps/Waze (`movo-mobile`,
 *   `src/lib/navigation-deeplink.ts`), a costo cero para Movo, en vez de pagar el
 *   Navigation SDK (~US$25/1.000, 5x Compute Routes) o reimplementar re-routing en
 *   loop. Queda tipado para no rediseñar el contrato si algún día se decide una
 *   navegación 100% in-app; mientras tanto, pedirlo falla explícito
 *   (`assertSupportedRouteMode`) en vez de fingir soporte.
 */
export type RouteMode = "per_trip" | "live";

export interface RouteInput {
  origin: RouteLatLng;
  destination: RouteLatLng;
  /** Default `per_trip` — los callers previos a MOVO-237 no lo pasan. */
  mode?: RouteMode;
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

/** Guard compartido por todas las implementaciones de `getRoute`: corta antes de
 * cualquier llamada facturable si se pide un modo que no existe todavía (ver
 * `RouteMode`). */
export function assertSupportedRouteMode(input: RouteInput): void {
  if (input.mode === "live") {
    throw new ApiError(
      501,
      "ROUTE_MODE_NOT_IMPLEMENTED",
      'El modo de ruta "live" no está implementado: la navegación se delega a la app de mapas del dispositivo.',
    );
  }
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
