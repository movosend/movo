import { haversineDistanceKm } from "./shipment-format";

export type RoutePoint = { latitude: number; longitude: number };

export interface RouteSplit {
  /** De la primera posición de la ruta al punto proyectado (lo recorrido). */
  done: RoutePoint[];
  /** Del vehículo al punto proyectado y de ahí al final (lo que falta). Si el vehículo se alejó de
   * la línea, el primer tramo es la recta vehículo → proyección. */
  todo: RoutePoint[];
  /** Índice del tramo donde cayó la proyección: pasarlo como `startSegment` en la próxima lectura
   * evita que el avance retroceda cuando la ruta vuelve a pasar cerca de un tramo anterior. */
  segment: number;
  /** Distancia del vehículo a la línea. */
  offRouteMeters: number;
}

function distanceMeters(a: RoutePoint, b: RoutePoint): number {
  return haversineDistanceKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
}

/**
 * Parte una ruta planificada en lo recorrido y lo que falta, proyectando la posición sobre el tramo
 * más cercano (MOVO-346). Port de `remainingRouteProgress` del mapa de seguimiento del panel
 * (`movo-admin/lib/shipments/tracking/geometry.ts`, MOVO-328), con puntos `{latitude, longitude}`
 * de `react-native-maps`. Lo usan "Mi ruta" (el polyline arranca donde estaba el transportista al
 * pedirlo y se cachea: sin recortarlo queda una cola detrás del ícono) y el seguimiento del envío.
 */
export function splitRoute(planned: RoutePoint[], from: RoutePoint | null, startSegment = 0): RouteSplit {
  if (planned.length === 0) return { done: [], todo: [], segment: 0, offRouteMeters: 0 };
  if (!from || planned.length === 1) return { done: [], todo: planned, segment: 0, offRouteMeters: 0 };
  const first = Math.min(Math.max(0, startSegment), planned.length - 2);
  // Coordenadas locales: los dos ejes en la misma escala para comparar tramos.
  const scale = Math.cos((from.latitude * Math.PI) / 180);
  let nearest = first;
  let best = Infinity;
  let projected = planned[first];
  for (let i = first; i < planned.length - 1; i++) {
    const a = planned[i];
    const b = planned[i + 1];
    const dx = (b.longitude - a.longitude) * scale;
    const dy = b.latitude - a.latitude;
    const length2 = dx * dx + dy * dy;
    const fraction =
      length2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((from.longitude - a.longitude) * scale * dx + (from.latitude - a.latitude) * dy) / length2),
          );
    const point = {
      latitude: a.latitude + (b.latitude - a.latitude) * fraction,
      longitude: a.longitude + (b.longitude - a.longitude) * fraction,
    };
    const d = distanceMeters(from, point);
    if (d < best) {
      best = d;
      nearest = i;
      projected = point;
    }
  }
  return {
    done: [...planned.slice(0, nearest + 1), projected],
    todo: [from, projected, ...planned.slice(nearest + 1)],
    segment: nearest,
    offRouteMeters: best,
  };
}

/** Margen sobre la distancia mínima para dar por alcanzada una parada en `routeUntilStop`. */
const STOP_MATCH_TOLERANCE_M = 40;

/**
 * El tramo de `route` desde su inicio hasta `stop` (MOVO-346, punto 14): el tramo activo de "Mi ruta",
 * con la ruta arrancando en el vehículo y `stop` como la próxima parada. Se corta en el **primer**
 * vértice que queda a la distancia mínima de la parada (más un margen), no en el más cercano de toda
 * la ruta: si la ruta vuelve a pasar cerca más adelante (un lazo, una calle paralela, otra parada en la
 * misma cuadra), ese paso es de un tramo posterior. Vacío si el vehículo ya está en la parada.
 */
export function routeUntilStop(route: RoutePoint[], stop: RoutePoint): RoutePoint[] {
  if (route.length < 2) return [];
  const distances = route.map((point) => distanceMeters(point, stop));
  if (distances[0] <= STOP_MATCH_TOLERANCE_M) return [];
  const threshold = Math.min(...distances.slice(1)) + STOP_MATCH_TOLERANCE_M;
  const end = distances.findIndex((d, index) => index > 0 && d <= threshold);
  return route.slice(0, end + 1);
}
