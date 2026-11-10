import { splitRoute, type RoutePoint } from "./route-geometry";

/**
 * Estilo único de las líneas del seguimiento en vivo (`LiveMap` y el mapa del detalle,
 * `RouteMapCard`). Feedback de TestFlight build 18: el punteado (`lineDashPattern`) se veía rayado
 * en Google Maps de iOS, y con la base gris debajo parecía una línea doble. Quedan dos capas,
 * siempre continuas: lo que falta en el gris de la ruta de toda la app (`fg3`, el mismo de la base
 * de `RouteMapCard`) y lo recorrido en tinta (`fg1`).
 */
export const LIVE_REMAINING_LINE_WIDTH = 3.5;
export const LIVE_TRACE_LINE_WIDTH = 4;

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
