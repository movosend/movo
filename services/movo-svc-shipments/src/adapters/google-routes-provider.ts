import { ApiError } from "@movo/shared";
import { RouteDurationResult, RouteInput, RouteMatrixInput, RouteResult, RoutesProvider } from "./routes-provider";

export interface GoogleRoutesProviderConfig {
  apiKey: string;
  baseUrl?: string;
  matrixBaseUrl?: string;
}

const DEFAULT_BASE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
// `Compute Route Matrix` (ADR-015/ADR-008) -- distinto endpoint del `Compute Routes` de
// arriba, un origen x N destinos en una sola llamada facturable.
const DEFAULT_MATRIX_BASE_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
// Solo lo que el mapa necesita — Compute Routes cobra por Field Mask solicitado, pedir
// de más infla el costo de cada llamada sin usarlo (mismo criterio de austeridad de
// cuota que ADR-015/`GOOGLE_MAPS_MAX_ELEMENTS` en `svc-pricing-logistics`).
const FIELD_MASK = "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration";
const MATRIX_FIELD_MASK = "originIndex,destinationIndex,condition,duration";
const REQUEST_TIMEOUT_MS = 5000;

interface GoogleComputeRoutesResponse {
  routes?: Array<{
    distanceMeters: number;
    duration: string; // p.ej. "312s"
    polyline: { encodedPolyline: string };
  }>;
}

interface GoogleRouteMatrixElement {
  originIndex?: number;
  destinationIndex: number;
  condition?: string; // "ROUTE_EXISTS" | "ROUTE_NOT_FOUND"
  duration?: string; // p.ej. "312s"
}

function parseDurationSeconds(duration: string): number {
  return Number.parseInt(duration.replace("s", ""), 10) || 0;
}

/**
 * Implementación real de `RoutesProvider` sobre la Google Routes API (método
 * `Compute Routes`, distinto del `Compute Route Matrix` de ADR-015 que usa
 * `svc-pricing-logistics` para la matriz del VRPTW) — MOVO-123. Proxeada server-side
 * igual que `GoogleGeocodingProvider` (ADR-014): la API key server-side no viaja al
 * cliente.
 */
export function createGoogleRoutesProvider(config: GoogleRoutesProviderConfig): RoutesProvider {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const matrixBaseUrl = config.matrixBaseUrl ?? DEFAULT_MATRIX_BASE_URL;
  return {
    async getRoute(input: RouteInput): Promise<RouteResult> {
      let response: Response;
      try {
        response = await fetch(baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": config.apiKey,
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify({
            origin: { location: { latLng: { latitude: input.origin.lat, longitude: input.origin.lng } } },
            destination: {
              location: { latLng: { latitude: input.destination.lat, longitude: input.destination.lng } },
            },
            travelMode: "DRIVE",
            polylineQuality: "OVERVIEW",
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new ApiError(502, "ROUTES_PROVIDER_ERROR", "No se pudo conectar con el proveedor de rutas.");
      }

      if (!response.ok) {
        throw new ApiError(502, "ROUTES_PROVIDER_ERROR", "El proveedor de rutas devolvió un error.");
      }

      const body = (await response.json()) as GoogleComputeRoutesResponse;
      const first = body.routes?.[0];
      if (!first) {
        throw new ApiError(422, "ROUTE_NOT_FOUND", "No pudimos calcular una ruta entre esos dos puntos.");
      }

      return {
        polyline: first.polyline.encodedPolyline,
        distanceMeters: first.distanceMeters,
        durationSeconds: parseDurationSeconds(first.duration),
      };
    },

    async getRouteDurations(input: RouteMatrixInput): Promise<RouteDurationResult[]> {
      if (input.destinations.length === 0) {
        return [];
      }

      let response: Response;
      try {
        response = await fetch(matrixBaseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": config.apiKey,
            "X-Goog-FieldMask": MATRIX_FIELD_MASK,
          },
          body: JSON.stringify({
            origins: [
              { waypoint: { location: { latLng: { latitude: input.origin.lat, longitude: input.origin.lng } } } },
            ],
            destinations: input.destinations.map((destination) => ({
              waypoint: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
            })),
            travelMode: "DRIVE",
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new ApiError(502, "ROUTES_PROVIDER_ERROR", "No se pudo conectar con el proveedor de rutas.");
      }

      if (!response.ok) {
        throw new ApiError(502, "ROUTES_PROVIDER_ERROR", "El proveedor de rutas devolvió un error.");
      }

      const elements = (await response.json()) as GoogleRouteMatrixElement[];
      // Default a `null` por índice -- un elemento ausente de la respuesta (o con
      // `condition !== "ROUTE_EXISTS"`) no debe tirar abajo el resto de la matriz.
      const results: RouteDurationResult[] = input.destinations.map((_, destinationIndex) => ({
        destinationIndex,
        durationSeconds: null,
      }));

      for (const element of elements) {
        if (element.condition === "ROUTE_EXISTS" && element.duration && results[element.destinationIndex]) {
          results[element.destinationIndex] = {
            destinationIndex: element.destinationIndex,
            durationSeconds: parseDurationSeconds(element.duration),
          };
        }
      }

      return results;
    },
  };
}
