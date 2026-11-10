import { polylineLengthKm } from "./polyline";
import { splitRoute, type RoutePoint } from "./route-geometry";

/**
 * Estilo único de las líneas del seguimiento en vivo (el mapa del detalle, `RouteMapCard`, el único
 * desde MOVO-361). Feedback de TestFlight build 18: el punteado (`lineDashPattern`) se veía rayado
 * en Google Maps de iOS, y con la base gris debajo parecía una línea doble. Quedan dos capas,
 * siempre continuas: lo que falta en el gris de la ruta de toda la app (`fg3`, el mismo de la base
 * de `RouteMapCard`) y lo recorrido en tinta (`fg1`).
 */
export const LIVE_REMAINING_LINE_WIDTH = 3.5;
export const LIVE_TRACE_LINE_WIDTH = 4;
/** Grosor de la ruta sin seguimiento (base gris y barrido): el mismo gris que lo que falta en vivo. */
export const ROUTE_LINE_WIDTH = LIVE_REMAINING_LINE_WIDTH;

/** Capas del mapa (MOVO-355): lo que falta o la base abajo, lo recorrido o el barrido arriba. */
export const ROUTE_BELOW_Z_INDEX = 1;
export const ROUTE_ABOVE_Z_INDEX = 2;

/** Por encima de esta distancia a la ruta, lo que falta arranca en la proyección y no en el
 * vehículo: unirlos sería una recta que no sigue ninguna calle. */
const MAX_JOIN_OFF_ROUTE_M = 60;

export type LivePhase = "pickup" | "delivery";

export interface LiveRouteLines {
  /** Lo que falta, en gris. */
  remaining: RoutePoint[];
  /** Lo recorrido, en tinta. Termina en el vehículo. */
  trace: RoutePoint[];
  /** Tramo de la proyección, para pasarlo como `startSegment` en la próxima posición. */
  segment: number;
}

/**
 * Arma las dos líneas del seguimiento según la etapa:
 * - `pickup` (envío `assigned`): la ruta planificada es retiro → entrega y el vehículo todavía no
 *   la recorre. Se dibuja entera, sin recortar desde el vehículo (eso era la recta del primer
 *   tramo), y no hay recorrido.
 * - `delivery` (`in_transit`): lo que falta desde la proyección del vehículo sobre la ruta, y el
 *   recorrido persistido cerrado con la posición en vivo, así no queda un hueco entre el último
 *   punto guardado (uno cada ~45 s) y el ícono.
 */
export function liveRouteLines(input: {
  phase: LivePhase;
  planned: RoutePoint[];
  trace: RoutePoint[];
  carrier: RoutePoint | null;
  startSegment?: number;
}): LiveRouteLines {
  const { phase, planned, trace, carrier, startSegment = 0 } = input;
  if (phase === "pickup") return { remaining: planned, trace: [], segment: 0 };

  const closedTrace = carrier && trace.length > 0 ? [...trace, carrier] : trace;
  if (!carrier || planned.length < 2) return { remaining: planned, trace: closedTrace, segment: startSegment };

  const split = splitRoute(planned, carrier, startSegment);
  const remaining = split.offRouteMeters > MAX_JOIN_OFF_ROUTE_M ? split.todo.slice(1) : split.todo;
  return { remaining, trace: closedTrace, segment: split.segment };
}

export type LiveArrivalEstimate =
  | { kind: "eta"; target: "pickup" | "delivery"; km: number; minutes: number }
  | { kind: "stage"; text: string }
  | { kind: "unknown" };

export const RECEIVER_PICKUP_STAGE_TEXT = "El transportista todavía no retiró el paquete";

/**
 * Llegada estimada y km del sheet del seguimiento a pantalla completa (MOVO-361):
 * - `delivery`: km sobre lo que falta de la ruta (la línea gris que se dibuja); sin ruta, en línea
 *   recta al destino.
 * - `pickup`: el emisor ve la distancia en línea recta al retiro (todavía no hay ruta del
 *   transportista al retiro, MOVO-359). El receptor no ve el retiro (MOVO-194 AC4): solo la etapa.
 */
export function liveArrivalEstimate(input: {
  phase: LivePhase;
  viewer: "sender" | "receiver";
  remaining: RoutePoint[];
  carrier: RoutePoint | null;
  pickup: RoutePoint | null;
  delivery: RoutePoint | null;
}): LiveArrivalEstimate {
  const { phase, viewer, remaining, carrier, pickup, delivery } = input;
  if (phase === "pickup") {
    if (viewer === "receiver") return { kind: "stage", text: RECEIVER_PICKUP_STAGE_TEXT };
    if (!carrier || !pickup) return { kind: "unknown" };
    return eta("pickup", straightKm(carrier, pickup));
  }
  if (!carrier) return { kind: "unknown" };
  if (remaining.length > 1) return eta("delivery", polylineLengthKm(remaining));
  if (!delivery) return { kind: "unknown" };
  return eta("delivery", straightKm(carrier, delivery));
}

function straightKm(a: RoutePoint, b: RoutePoint): number {
  return polylineLengthKm([a, b]);
}

/**
 * Minutos estimados de llegada para una distancia (~2 min por km, entorno urbano/interurbano; con
 * menos de 200 m, ~2 min). Heurística: no hay ETA del proveedor de rutas para el seguimiento.
 */
export function estimateArrivalMinutes(distanceKm: number): number {
  if (distanceKm < 0.2) return 2;
  return Math.max(3, Math.round(distanceKm * 2));
}

function eta(target: "pickup" | "delivery", rawKm: number): LiveArrivalEstimate {
  const km = Number(rawKm.toFixed(1));
  return { kind: "eta", target, km, minutes: estimateArrivalMinutes(km) };
}
