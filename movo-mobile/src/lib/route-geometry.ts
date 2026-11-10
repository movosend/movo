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
  // El más cercano; en un empate, el primero.
  const nearest = projectOnSegments(planned, from, startSegment).reduce((best, candidate) =>
    candidate.distance < best.distance ? candidate : best,
  );
  return {
    done: [...planned.slice(0, nearest.index + 1), nearest.point],
    todo: [from, nearest.point, ...planned.slice(nearest.index + 1)],
    segment: nearest.index,
    offRouteMeters: nearest.distance,
  };
}

interface SegmentProjection {
  /** Índice del tramo (`planned[index]` → `planned[index + 1]`). */
  index: number;
  /** Punto del tramo más cercano a la posición. */
  point: RoutePoint;
  distance: number;
  /** Rumbo del tramo en grados (0 = norte, 90 = este), o `null` si el tramo no tiene largo. */
  bearing: number | null;
}

/** La posición proyectada sobre cada tramo desde `startSegment` (al menos uno: `planned` tiene 2 puntos o más). */
function projectOnSegments(planned: RoutePoint[], from: RoutePoint, startSegment: number): SegmentProjection[] {
  const first = Math.min(Math.max(0, startSegment), planned.length - 2);
  // Coordenadas locales: los dos ejes en la misma escala para comparar tramos.
  const scale = Math.cos((from.latitude * Math.PI) / 180);
  const projections: SegmentProjection[] = [];
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
    const bearing = length2 === 0 ? null : ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    projections.push({ index: i, point, distance: distanceMeters(from, point), bearing });
  }
  return projections;
}

/** Hasta esta distancia a la línea, la ruta de "Mi ruta" arranca en la proyección y no en el auto
 * (MOVO-357): con el GPS a pocos metros de la calle, la recta auto → línea es ruido, y si la
 * proyección quedó atrás dibuja un "va y vuelve". */
export const CARRIER_ON_ROUTE_METERS = 50;

export interface CarrierRouteLine {
  /** Lo que falta, para dibujar. */
  points: RoutePoint[];
  /** Tramo para pasar como `startSegment` en la próxima posición. */
  segment: number;
}

/** Tramos a esta distancia de más del más cercano cuentan como "igual de cerca": el ruido del GPS no
 * alcanza para decidir entre dos pasadas por la misma calle. */
const SEGMENT_TIE_METERS = 15;
/** Diferencia máxima entre el rumbo del auto y el del tramo para que el tramo vaya "para el mismo lado". */
const HEADING_TOLERANCE_DEG = 90;

function angleBetween(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Lo que le falta al transportista en "Mi ruta" (MOVO-357, la ruta verde que hacía un triángulo).
 * La línea de `my-route` arranca donde estaba el auto al pedirla (el backend la guarda 2 h), así que
 * se recorta desde el auto:
 * - El tramo nunca retrocede: se busca desde `startSegment`, que el caller guarda entre posiciones.
 * - Tampoco salta para adelante por ruido: entre los tramos igual de cerca (`SEGMENT_TIE_METERS`) se
 *   queda con el primero. Una ruta que pasa dos veces por la misma calle (vuelta en U) tiene la ida y la
 *   vuelta a la misma distancia, y lo único que las distingue es para dónde van: con `heading` (el rumbo
 *   del GPS, solo si el auto se mueve) se descartan los tramos que van en contra.
 * - Cerca de la línea (`CARRIER_ON_ROUTE_METERS`) arranca en la proyección, sin recta. Más lejos (otra
 *   calle) la recta auto → línea queda, y no se avanza el tramo: una posición lejana no es avance.
 */
export function carrierRouteLine(
  planned: RoutePoint[],
  carrier: RoutePoint | null,
  startSegment = 0,
  heading?: number,
): CarrierRouteLine {
  if (!carrier || planned.length < 2) return { points: planned, segment: startSegment };
  const projections = projectOnSegments(planned, carrier, startSegment);
  const best = Math.min(...projections.map((p) => p.distance));
  const near = projections.filter((p) => p.distance <= best + SEGMENT_TIE_METERS);
  const sameDirection =
    heading === undefined
      ? near
      : near.filter((p) => p.bearing === null || angleBetween(p.bearing, heading) <= HEADING_TOLERANCE_DEG);
  const chosen = (sameDirection.length > 0 ? sameDirection : near)[0]!;
  const rest = planned.slice(chosen.index + 1);
  if (chosen.distance <= CARRIER_ON_ROUTE_METERS) {
    return { points: [chosen.point, ...rest], segment: chosen.index };
  }
  return { points: [carrier, chosen.point, ...rest], segment: startSegment };
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
