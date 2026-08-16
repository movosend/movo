import { RouteInput, RouteResult, RoutesProvider } from "./routes-provider";
import { encodePolyline } from "../utils/polyline-encode";

// Cantidad de puntos interpolados entre origen y destino — suficiente para que el
// trazo se vea como una polilínea real (no un segmento único) sin sobrecargar el
// payload; el mock no conoce calles, solo interpola en línea recta.
const ROUTE_STEPS = 24;
// Velocidad promedio asumida para estimar duración (urbana, sin tráfico real) —
// mismo criterio de placeholder documentado que `WEIGHT_KG_MAX`/`suggestedPriceArs`
// en `shipments.service.ts` (MOVO-80): un número razonable, no una medición real.
const AVERAGE_SPEED_KMH = 30;
const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distancia haversine entre dos puntos — mismo cálculo que ya usa
 * `shipments.service.ts` para el placeholder de `suggestedPriceArs` (MOVO-80). */
function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/**
 * Implementación de desarrollo (ROUTES_PROVIDER=mock, default): interpola una línea
 * recta entre origen y destino y la codifica con el mismo algoritmo de polyline que
 * la Google Routes API real, sin red — mismo criterio que `MockGeocodingProvider`.
 * Determinístico dado el mismo input.
 */
export function createMockRoutesProvider(): RoutesProvider {
  return {
    async getRoute(input: RouteInput): Promise<RouteResult> {
      const points = [];
      for (let i = 0; i <= ROUTE_STEPS; i += 1) {
        const t = i / ROUTE_STEPS;
        points.push({
          lat: input.origin.lat + (input.destination.lat - input.origin.lat) * t,
          lng: input.origin.lng + (input.destination.lng - input.origin.lng) * t,
        });
      }

      const distanceMeters = haversineDistanceMeters(input.origin, input.destination);
      const durationSeconds = Math.round((distanceMeters / 1000 / AVERAGE_SPEED_KMH) * 3600);

      return {
        polyline: encodePolyline(points),
        distanceMeters: Math.round(distanceMeters),
        durationSeconds,
      };
    },
  };
}
