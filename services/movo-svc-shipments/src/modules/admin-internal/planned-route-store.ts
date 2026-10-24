import type Redis from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import { RouteLatLng, RouteResult, RoutesProvider } from "../../adapters/routes-provider";

/**
 * MOVO-327: ruta planificada del retiro a la entrega para el mapa del panel. Google la factura por llamada
 * (ADR-015) y el panel hace polling: sin cache, cada admin con el mapa abierto la pediría en cada tick.
 * La clave lleva el proveedor y las coordenadas: si cambian, o se pasa de `mock` a `google`, se vuelve a pedir.
 */
export const PLANNED_ROUTE_TTL_SECONDS = 6 * 60 * 60;
/** Cache negativo: con el proveedor caído o sin cuota, no se reintenta en cada tick de cada admin. */
export const PLANNED_ROUTE_FAILURE_TTL_SECONDS = 60;

export interface PlannedRouteStore {
  /** `null` si el proveedor falló: el seguimiento sale igual, sin ruta. */
  get(shipmentId: string, origin: RouteLatLng, destination: RouteLatLng): Promise<RouteResult | null>;
}

export interface PlannedRouteStoreDeps {
  redis: Pick<Redis, "get" | "set">;
  routesProvider: Pick<RoutesProvider, "getRoute">;
  provider: string;
  logger?: Pick<FastifyBaseLogger, "warn">;
}

const isRouteResult = (value: unknown): value is RouteResult =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as RouteResult).polyline === "string" &&
  typeof (value as RouteResult).distanceMeters === "number" &&
  typeof (value as RouteResult).durationSeconds === "number";

export function createPlannedRouteStore(deps: PlannedRouteStoreDeps): PlannedRouteStore {
  // Dos admins que abren el mismo envío a la vez comparten el pedido (alcanza con una instancia del servicio).
  const inFlight = new Map<string, Promise<RouteResult | null>>();

  async function fetchAndCache(key: string, shipmentId: string, origin: RouteLatLng, destination: RouteLatLng) {
    let route: RouteResult;
    try {
      route = await deps.routesProvider.getRoute({ origin, destination, mode: "per_trip" });
    } catch (err) {
      deps.logger?.warn({ err, shipmentId }, "admin_tracking_route_unavailable");
      await deps.redis
        .set(`${key}:failed`, "1", "EX", PLANNED_ROUTE_FAILURE_TTL_SECONDS)
        .catch((setErr: unknown) => deps.logger?.warn({ err: setErr, shipmentId }, "admin_tracking_route_cache_failed"));
      return null;
    }
    await deps.redis
      .set(key, JSON.stringify(route), "EX", PLANNED_ROUTE_TTL_SECONDS)
      .catch((err: unknown) => deps.logger?.warn({ err, shipmentId }, "admin_tracking_route_cache_failed"));
    return route;
  }

  return {
    async get(shipmentId, origin, destination) {
      const key = `admin_tracking_route:${deps.provider}:${shipmentId}:${origin.lat},${origin.lng}:${destination.lat},${destination.lng}`;
      // Redis es accesorio: si falla la lectura se trata como miss y se pide al proveedor.
      const [raw, failed] = await Promise.all([
        deps.redis.get(key),
        deps.redis.get(`${key}:failed`),
      ]).catch((err: unknown) => {
        deps.logger?.warn({ err, shipmentId }, "admin_tracking_route_cache_failed");
        return [null, null] as const;
      });
      if (!raw && failed) return null;
      if (raw) {
        try {
          const cached: unknown = JSON.parse(raw);
          if (isRouteResult(cached)) return cached;
        } catch {
          // Valor corrupto: se vuelve a pedir.
        }
      }
      let pending = inFlight.get(key);
      if (!pending) {
        pending = fetchAndCache(key, shipmentId, origin, destination).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      return pending;
    },
  };
}
