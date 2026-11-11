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

export function createApproachRouteStore(deps: {
  redis: Pick<Redis, "get" | "set">;
  routesProvider: Pick<RoutesProvider, "getRoute">;
  provider: string;
  logger?: Pick<FastifyBaseLogger, "warn"> & Partial<Pick<FastifyBaseLogger, "info">>;
}): PlannedRouteStore {
  return createPlannedRouteStore({
    ...deps,
    logTag: "approach_route",
    successTtlSeconds: APPROACH_ROUTE_TTL_SECONDS,
    keyFor: (shipmentId, origin, destination) =>
      `approach_route:${deps.provider}:${shipmentId}:${origin.lat.toFixed(APPROACH_CELL_DECIMALS)},${origin.lng.toFixed(APPROACH_CELL_DECIMALS)}:${destination.lat},${destination.lng}`,
  });
}
