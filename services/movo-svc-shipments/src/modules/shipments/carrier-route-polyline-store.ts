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

/** MOVO-357: el rumbo del auto al pedir la ruta. No es parte de la clave (igual que el origen): pesa cuando
 * no hay línea guardada, o una vez para rearmar la que se armó sin rumbo. */
export interface CarrierRoutePolylineOrigin extends RouteLatLng {
  heading?: number;
}

export interface CarrierRoutePolylineStore {
  /** `null` si el proveedor falló: la ruta sale igual y el mapa cae a las rectas. */
  get(carrierId: string, origin: CarrierRoutePolylineOrigin, stops: CarrierRoutePolylineStop[]): Promise<string | null>;
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

  async function fetchAndCache(
    key: string,
    carrierId: string,
    origin: CarrierRoutePolylineOrigin,
    stops: CarrierRoutePolylineStop[],
  ) {
    // Más paradas que el límite de Google: el camino cubre las primeras (el resto sigue con rectas en el mapa).
    const waypoints = stops.slice(0, MAX_ROUTE_INTERMEDIATES + 1);
    const destination = waypoints[waypoints.length - 1]!;
    let polyline: string;
    try {
      const route = await deps.routesProvider.getRoute({
        origin: { lat: origin.lat, lng: origin.lng },
        ...(origin.heading === undefined ? {} : { originHeading: origin.heading }),
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
    const builtWithHeading = origin.heading === undefined ? "0" : "1";
    await Promise.all([
      deps.redis.set(key, polyline, "EX", CARRIER_ROUTE_POLYLINE_TTL_SECONDS),
      deps.redis.set(`${key}:heading`, builtWithHeading, "EX", CARRIER_ROUTE_POLYLINE_TTL_SECONDS),
    ]).catch((err: unknown) => warn(err, carrierId, "my_route_polyline_cache_failed"));
    return polyline;
  }

  return {
    async get(carrierId, origin, stops) {
      if (stops.length === 0) return null;
      const key = `my_route_polyline:${deps.provider}:${carrierId}:${stopsFingerprint(stops)}`;
      // Redis es accesorio: si falla la lectura se trata como miss y se pide al proveedor.
      const [cached, failed, builtWithHeading] = await Promise.all([
        deps.redis.get(key),
        deps.redis.get(`${key}:failed`),
        deps.redis.get(`${key}:heading`),
      ]).catch((err: unknown) => {
        warn(err, carrierId, "my_route_polyline_cache_failed");
        return [null, null, null] as const;
      });
      // MOVO-357 (review de la #336): la línea se arma casi siempre en el pedido del foco, antes de que el
      // GPS tenga rumbo. El primer pedido con rumbo sobre una línea armada sin él la rearma, una sola vez
      // (queda marcada) y desde la posición de ahora. Si el proveedor falla, sigue la que había.
      const upgrade = cached !== null && origin.heading !== undefined && builtWithHeading === "0" && !failed;
      if (cached && !upgrade) return cached;
      if (!cached && failed) return null;
      const polyline = await fetchAndCache(key, carrierId, origin, stops);
      return polyline ?? cached;
    },
  };
}
