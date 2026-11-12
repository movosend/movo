import type Redis from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import type { RoutesProvider } from "../../adapters/routes-provider";
import { createPlannedRouteStore, type PlannedRouteStore } from "./planned-route-store";

/**
 * MOVO-359: ruta por calle del transportista al punto de retiro, para que el mapa de emisor y receptor la
 * dibuje antes del retiro en vez de una recta. A diferencia de la ruta planificada (retiro -> entrega, que no
 * cambia), el origen se mueve con el vehículo: la clave redondea la posición a ~110 m (3 decimales) y la
 * ruta vive 2 minutos. Con el auto en la misma celda se reusa la misma ruta aunque su origen quede a unas
 * decenas de metros; el móvil la recorta desde la posición real. Una celda nueva es un pedido nuevo (ADR-015,
 * se factura por llamada), y el móvil solo lo pide al desviarse de la línea, no por cada ping.
 */
export const APPROACH_ROUTE_TTL_SECONDS = 2 * 60;
export const APPROACH_CELL_DECIMALS = 3;
/**
 * Tope por envío (review PR-340): el límite del móvil (una renovación por minuto) es por dispositivo y
 * depende del cliente. Sin rumbo, Google puede arrancar la ruta con una vuelta en U en una avenida de mano
 * única; el auto sigue derecho, se desvía de la línea y se pide otra con el mismo problema. Pasado el tope se
 * devuelve la última ruta del envío (el móvil la recorta y suma el tramo hasta ella) hasta la ventana siguiente.
 */
export const APPROACH_ROUTE_BUDGET_MAX = 5;
export const APPROACH_ROUTE_BUDGET_WINDOW_SECONDS = 10 * 60;

export function createApproachRouteStore(deps: {
  redis: Pick<Redis, "get" | "set" | "incr" | "expire">;
  routesProvider: Pick<RoutesProvider, "getRoute">;
  provider: string;
  logger?: Pick<FastifyBaseLogger, "warn"> & Partial<Pick<FastifyBaseLogger, "info">>;
}): PlannedRouteStore {
  return createPlannedRouteStore({
    ...deps,
    logTag: "approach_route",
    successTtlSeconds: APPROACH_ROUTE_TTL_SECONDS,
    callBudget: { max: APPROACH_ROUTE_BUDGET_MAX, windowSeconds: APPROACH_ROUTE_BUDGET_WINDOW_SECONDS },
    keyFor: (shipmentId, origin, destination) =>
      `approach_route:${deps.provider}:${shipmentId}:${origin.lat.toFixed(APPROACH_CELL_DECIMALS)},${origin.lng.toFixed(APPROACH_CELL_DECIMALS)}:${destination.lat},${destination.lng}`,
  });
}
