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

/** Tope de llamadas reales al proveedor por envío y ventana de tiempo (MOVO-359, review PR-340). */
export interface RouteCallBudget {
  max: number;
  windowSeconds: number;
}

export interface PlannedRouteStoreDeps {
  /** `incr`/`expire` solo hacen falta con `callBudget`. */
  redis: Pick<Redis, "get" | "set"> & Partial<Pick<Redis, "incr" | "expire">>;
  routesProvider: Pick<RoutesProvider, "getRoute">;
  provider: string;
  logger?: Pick<FastifyBaseLogger, "warn"> & Partial<Pick<FastifyBaseLogger, "info">>;
  /** Prefijo de los logs (`<tag>_unavailable`, `<tag>_cache_failed`, `<tag>_provider_call`). Default `admin_tracking_route`. */
  logTag?: string;
  /** Vida de una ruta cacheada. Default `PLANNED_ROUTE_TTL_SECONDS`. */
  successTtlSeconds?: number;
  /** Clave de cache. Default: `admin_tracking_route:<proveedor>:<envío>:<origen>:<destino>`, con las coordenadas exactas. */
  keyFor?: (shipmentId: string, origin: RouteLatLng, destination: RouteLatLng) => string;
  /**
   * Máximo de llamadas reales al proveedor por envío en una ventana fija (`<tag>:budget:<envío>:<ventana>`).
   * Pasado el tope se devuelve la última ruta obtenida para el envío en esa ventana, o `null`, sin llamar.
   * Sin él no hay tope (la ruta planificada no lo necesita: su clave no cambia).
   */
  callBudget?: RouteCallBudget;
}

const isRouteResult = (value: unknown): value is RouteResult =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as RouteResult).polyline === "string" &&
  typeof (value as RouteResult).distanceMeters === "number" &&
  typeof (value as RouteResult).durationSeconds === "number";

export function createPlannedRouteStore(deps: PlannedRouteStoreDeps): PlannedRouteStore {
  const logTag = deps.logTag ?? "admin_tracking_route";
  // Dos admins que abren el mismo envío a la vez comparten el pedido (alcanza con una instancia del servicio).
  const inFlight = new Map<string, Promise<RouteResult | null>>();
  const budget = deps.callBudget;
  const lastKey = (shipmentId: string) => `${logTag}:last:${shipmentId}`;

  const parseRoute = (raw: string | null): RouteResult | null => {
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      return isRouteResult(value) ? value : null;
    } catch {
      return null;
    }
  };

  /**
   * Cuenta la llamada contra el tope del envío. La ventana va en la clave (ventana fija): si el `expire` falla
   * el contador no bloquea para siempre, la ventana siguiente usa otra clave. Con Redis caído no hay tope (es
   * accesorio, como el cache): queda el límite del móvil.
   */
  async function withinBudget(shipmentId: string): Promise<boolean> {
    if (!budget || !deps.redis.incr || !deps.redis.expire) return true;
    const windowIndex = Math.floor(Date.now() / (budget.windowSeconds * 1000));
    const key = `${logTag}:budget:${shipmentId}:${windowIndex}`;
    try {
      const count = await deps.redis.incr(key);
      if (count === 1) await deps.redis.expire(key, budget.windowSeconds);
      return count <= budget.max;
    } catch (err) {
      deps.logger?.warn({ err, shipmentId }, `${logTag}_cache_failed`);
      return true;
    }
  }

  async function fetchAndCache(key: string, shipmentId: string, origin: RouteLatLng, destination: RouteLatLng) {
    let route: RouteResult;
    // Una línea por llamada real al proveedor (se factura, ADR-015): permite medir el gasto por tipo de ruta.
    deps.logger?.info?.({ shipmentId }, `${logTag}_provider_call`);
    try {
      route = await deps.routesProvider.getRoute({ origin, destination, mode: "per_trip" });
    } catch (err) {
      deps.logger?.warn({ err, shipmentId }, `${logTag}_unavailable`);
      await deps.redis
        .set(`${key}:failed`, "1", "EX", PLANNED_ROUTE_FAILURE_TTL_SECONDS)
        .catch((setErr: unknown) => deps.logger?.warn({ err: setErr, shipmentId }, `${logTag}_cache_failed`));
      return null;
    }
    await Promise.all([
      deps.redis.set(key, JSON.stringify(route), "EX", deps.successTtlSeconds ?? PLANNED_ROUTE_TTL_SECONDS),
      // La que se devuelve pasado el tope: vive lo mismo que la ventana.
      budget ? deps.redis.set(lastKey(shipmentId), JSON.stringify(route), "EX", budget.windowSeconds) : null,
    ]).catch((err: unknown) => deps.logger?.warn({ err, shipmentId }, `${logTag}_cache_failed`));
    return route;
  }

  async function fetchWithinBudget(key: string, shipmentId: string, origin: RouteLatLng, destination: RouteLatLng) {
    if (await withinBudget(shipmentId)) return fetchAndCache(key, shipmentId, origin, destination);
    deps.logger?.warn({ shipmentId }, `${logTag}_budget_exceeded`);
    const raw = await deps.redis.get(lastKey(shipmentId)).catch(() => null);
    return parseRoute(raw);
  }

  return {
    async get(shipmentId, origin, destination) {
      const key = deps.keyFor
        ? deps.keyFor(shipmentId, origin, destination)
        : `admin_tracking_route:${deps.provider}:${shipmentId}:${origin.lat},${origin.lng}:${destination.lat},${destination.lng}`;
      // Redis es accesorio: si falla la lectura se trata como miss y se pide al proveedor.
      const [raw, failed] = await Promise.all([
        deps.redis.get(key),
        deps.redis.get(`${key}:failed`),
      ]).catch((err: unknown) => {
        deps.logger?.warn({ err, shipmentId }, `${logTag}_cache_failed`);
        return [null, null] as const;
      });
      if (!raw && failed) return null;
      // Sin valor o corrupto: se vuelve a pedir.
      const cached = parseRoute(raw);
      if (cached) return cached;
      let pending = inFlight.get(key);
      if (!pending) {
        pending = fetchWithinBudget(key, shipmentId, origin, destination).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      return pending;
    },
  };
}
