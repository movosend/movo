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
/** Grosor de la ruta sin seguimiento (base gris y barrido), propio: no sigue al de la línea en vivo. */
export const ROUTE_LINE_WIDTH = 3.5;

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
  /** Tramo de la proyección, para pasarlo como `startSegment` en la próxima posición. Antes del retiro
   * es el de la ruta al retiro; en camino a la entrega, el de la ruta planificada. */
  segment: number;
  /** Antes del retiro: lo que falta de la ruta del vehículo al punto de retiro (ya incluido al frente de
   * `remaining`). Vacío en camino a la entrega o sin esa ruta. */
  toPickup: RoutePoint[];
  /** Metros del vehículo a la línea de `toPickup` cuando está tan lejos que no se unen en el dibujo (una
   * recta no sigue ninguna calle) pero ese tramo igual hay que recorrerlo: se suma a la distancia al retiro. */
  toPickupGapM: number;
}

/**
 * Arma las dos líneas del seguimiento según la etapa:
 * - `pickup` (envío `assigned`): la ruta planificada es retiro → entrega y el vehículo todavía no
 *   la recorre. Se dibuja entera, sin recortar desde el vehículo (eso era la recta del primer
 *   tramo), y no hay recorrido. MOVO-359: con la ruta del vehículo al retiro (`approach`) se dibuja
 *   una sola línea: lo que falta de ese tramo, recortado desde el vehículo, y después la planificada.
 * - `delivery` (`in_transit`): lo que falta desde la proyección del vehículo sobre la ruta, y el
 *   recorrido persistido cerrado con la posición en vivo, así no queda un hueco entre el último
 *   punto guardado (uno cada ~45 s) y el ícono.
 */
export function liveRouteLines(input: {
  phase: LivePhase;
  planned: RoutePoint[];
  trace: RoutePoint[];
  carrier: RoutePoint | null;
  /** Ruta por calle del vehículo al retiro (`approachRoute` del backend). Solo se usa antes del retiro. */
  approach?: RoutePoint[];
  startSegment?: number;
}): LiveRouteLines {
  const { phase, planned, trace, carrier, approach = [], startSegment = 0 } = input;
  if (phase === "pickup") {
    if (!carrier || approach.length < 2) {
      return { remaining: planned, trace: [], segment: 0, toPickup: [], toPickupGapM: 0 };
    }
    const toPickup = remainingFrom(approach, carrier, startSegment);
    return {
      remaining: [...toPickup.points, ...planned],
      trace: [],
      segment: toPickup.segment,
      toPickup: toPickup.points,
      toPickupGapM: toPickup.gapM,
    };
  }

  const closedTrace = carrier && trace.length > 0 ? [...trace, carrier] : trace;
  if (!carrier || planned.length < 2) {
    return { remaining: planned, trace: closedTrace, segment: startSegment, toPickup: [], toPickupGapM: 0 };
  }

  const rest = remainingFrom(planned, carrier, startSegment);
  return { remaining: rest.points, trace: closedTrace, segment: rest.segment, toPickup: [], toPickupGapM: 0 };
}

/** Lo que falta de una ruta desde el vehículo: arranca en su proyección, y solo se une a él con una recta si
 * está cerca de la línea (una recta lejos de la línea no sigue ninguna calle). */
function remainingFrom(route: RoutePoint[], carrier: RoutePoint, startSegment: number) {
  const split = splitRoute(route, carrier, startSegment);
  const detached = split.offRouteMeters > MAX_JOIN_OFF_ROUTE_M;
  return {
    points: detached ? split.todo.slice(1) : split.todo,
    segment: split.segment,
    gapM: detached ? split.offRouteMeters : 0,
  };
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
 * - `pickup`: el emisor ve la distancia al retiro, sobre la ruta por calle (MOVO-359) o, sin ella, en
 *   línea recta. El receptor ve solo la etapa: la llegada al retiro es dato del emisor.
 */
export function liveArrivalEstimate(input: {
  phase: LivePhase;
  viewer: "sender" | "receiver";
  remaining: RoutePoint[];
  /** Antes del retiro: lo que falta de la ruta del vehículo al retiro (`LiveRouteLines.toPickup`). */
  toPickup?: RoutePoint[];
  /** Tramo del vehículo a esa línea cuando no está unido a ella (`LiveRouteLines.toPickupGapM`). */
  toPickupGapM?: number;
  carrier: RoutePoint | null;
  pickup: RoutePoint | null;
  delivery: RoutePoint | null;
}): LiveArrivalEstimate {
  const { phase, viewer, remaining, toPickup = [], toPickupGapM = 0, carrier, pickup, delivery } = input;
  if (phase === "pickup") {
    if (viewer === "receiver") return { kind: "stage", text: RECEIVER_PICKUP_STAGE_TEXT };
    if (!carrier || !pickup) return { kind: "unknown" };
    // Sobre la ruta por calle al retiro; sin ella (todavía no llegó o el proveedor falló), en línea recta.
    return eta("pickup", toPickup.length > 1 ? polylineLengthKm(toPickup) + toPickupGapM / 1000 : straightKm(carrier, pickup));
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
