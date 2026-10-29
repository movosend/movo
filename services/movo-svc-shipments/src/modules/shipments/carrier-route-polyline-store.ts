import { createHash } from "node:crypto";
import type Redis from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import { MAX_ROUTE_INTERMEDIATES, RouteLatLng, RoutesProvider } from "../../adapters/routes-provider";

/**
 * MOVO-346 (punto 14): camino por calles de "Mi ruta", desde el transportista y por todas las paradas en el
 * orden de la ruta. El mobile pide `my-route` en cada poll y Google factura cada `computeRoutes` (ADR-015): se
 * cachea por transportista y orden de paradas. El origen es la posición del primer pedido; alcanza, porque el
 * mapa dibuja al transportista aparte y recorta la línea desde el punto más cercano al vehículo. Las paradas no
 * cambian sin cambiar la clave, así que el TTL solo acota ese origen viejo: es largo para que un viaje cueste
 * ~N+1 llamadas (una por cada orden de paradas) y no una cada pocos minutos de viaje.
 */
export const CARRIER_ROUTE_POLYLINE_TTL_SECONDS = 2 * 60 * 60;
/** Cache negativo: con el proveedor caído no se reintenta en cada poll. */
export const CARRIER_ROUTE_POLYLINE_FAILURE_TTL_SECONDS = 60;
/** Va después del optimizador (hasta `PRICING_OPTIMIZE_TIMEOUT_MS`) y en cada poll: se acota para no sumar los 5 s
 * del provider al peor caso del endpoint. Un timeout cae al cache negativo como cualquier falla. */
export const CARRIER_ROUTE_POLYLINE_TIMEOUT_MS = 2500;

export interface CarrierRoutePolylineStop extends RouteLatLng {
  shipmentId: string;
  type: string;
}

export interface CarrierRoutePolylineStore {
  /** `null` si el proveedor falló: la ruta sale igual y el mapa cae a las rectas. */
  get(carrierId: string, origin: RouteLatLng, stops: CarrierRoutePolylineStop[]): Promise<string | null>;
}

export interface CarrierRoutePolylineStoreDeps {
  redis: Pick<Redis, "get" | "set">;
  routesProvider: Pick<RoutesProvider, "getRoute">;
  provider: string;
  logger?: Pick<FastifyBaseLogger, "warn">;
}

/** Clave estable para el mismo orden de paradas (y sus coordenadas). */
function stopsFingerprint(stops: CarrierRoutePolylineStop[]): string {
  const raw = stops.map((s) => `${s.shipmentId}:${s.type}:${s.lat},${s.lng}`).join("|");
  return createHash("sha1").update(raw).digest("hex");
}

export function createCarrierRoutePolylineStore(deps: CarrierRoutePolylineStoreDeps): CarrierRoutePolylineStore {
  const warn = (err: unknown, carrierId: string, event: string) => deps.logger?.warn({ err, carrierId, event }, event);

  async function fetchAndCache(key: string, carrierId: string, origin: RouteLatLng, stops: CarrierRoutePolylineStop[]) {
    // Más paradas que el límite de Google: el camino cubre las primeras (el resto sigue con rectas en el mapa).
    const waypoints = stops.slice(0, MAX_ROUTE_INTERMEDIATES + 1);
    const destination = waypoints[waypoints.length - 1]!;
    let polyline: string;
    try {
      const route = await deps.routesProvider.getRoute({
        origin,
        destination,
        intermediates: waypoints.slice(0, -1),
        mode: "per_trip",
        timeoutMs: CARRIER_ROUTE_POLYLINE_TIMEOUT_MS,
      });
      polyline = route.polyline;
    } catch (err) {
      warn(err, carrierId, "my_route_polyline_failed");
      await deps.redis
        .set(`${key}:failed`, "1", "EX", CARRIER_ROUTE_POLYLINE_FAILURE_TTL_SECONDS)
        .catch((setErr: unknown) => warn(setErr, carrierId, "my_route_polyline_cache_failed"));
      return null;
    }
    await deps.redis
      .set(key, polyline, "EX", CARRIER_ROUTE_POLYLINE_TTL_SECONDS)
      .catch((err: unknown) => warn(err, carrierId, "my_route_polyline_cache_failed"));
    return polyline;
  }

  return {
    async get(carrierId, origin, stops) {
      if (stops.length === 0) return null;
      const key = `my_route_polyline:${deps.provider}:${carrierId}:${stopsFingerprint(stops)}`;
      // Redis es accesorio: si falla la lectura se trata como miss y se pide al proveedor.
      const [cached, failed] = await Promise.all([deps.redis.get(key), deps.redis.get(`${key}:failed`)]).catch(
        (err: unknown) => {
          warn(err, carrierId, "my_route_polyline_cache_failed");
          return [null, null] as const;
        },
      );
      if (cached) return cached;
      if (failed) return null;
      return fetchAndCache(key, carrierId, origin, stops);
    },
  };
}
