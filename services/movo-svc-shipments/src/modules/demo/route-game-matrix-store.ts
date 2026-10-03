import type Redis from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import { RouteMatrix } from "../../domain/route-game";
import { PricingLogisticsClient } from "../../adapters/pricing-logistics-client";
import { RouteGameScenario } from "./route-game.scenarios";

/**
 * Matriz de distancias/tiempos de cada ciudad del juego del optimizador. Con Google
 * Routes cada matriz se factura por elemento (N², ADR-015): pedir la del pool completo
 * una sola vez y reusarla en todas las partidas deja el costo de toda la feria en unos
 * 487 elementos (las 5 ciudades), en vez de ~49 por partida.
 *
 * 30 días alcanza para cualquier evento; los puntos del pool son fijos (si cambian, se
 * sube `version` en `route-game.scenarios.ts`). La matriz del mock no se cachea: no cuesta
 * nada y, si se guardara, seguiría sirviéndose después de pasar a `ROUTES_PROVIDER=google`.
 */
export const ROUTE_GAME_MATRIX_TTL_SECONDS = 30 * 24 * 60 * 60;

const matrixKey = (s: RouteGameScenario) => `route_game_matrix:${s.id}:v${s.version}`;

export interface CachedRouteMatrix extends RouteMatrix {
  provider: string;
}

/** Lo que muestra el indicador de costo del juego. */
export interface RouteMatrixCacheInfo {
  cache: "hit" | "miss";
  provider: string;
  elementsBilled: number;
}

export interface RouteGameMatrixStore {
  get(scenario: RouteGameScenario): Promise<{ matrix: CachedRouteMatrix; info: RouteMatrixCacheInfo }>;
}

export interface RouteGameMatrixStoreDeps {
  redis: Pick<Redis, "get" | "set">;
  pricingLogisticsClient: Pick<PricingLogisticsClient, "routeMatrix">;
  logger?: Pick<FastifyBaseLogger, "info" | "warn">;
}

export function createRouteGameMatrixStore(deps: RouteGameMatrixStoreDeps): RouteGameMatrixStore {
  // Dos iPads que arrancan a la vez la primera partida de una ciudad comparten el mismo
  // pedido en vez de facturarlo dos veces (alcanza con una instancia del servicio).
  const inFlight = new Map<string, Promise<{ matrix: CachedRouteMatrix; info: RouteMatrixCacheInfo }>>();

  async function fetchAndCache(scenario: RouteGameScenario) {
    const res = await deps.pricingLogisticsClient.routeMatrix({
      points: scenario.pool.map(([, , lat, lng]) => ({ lat, lng })),
    });
    const matrix: CachedRouteMatrix = { distKm: res.distKm, timeMin: res.timeMin, provider: res.provider };
    if (res.provider !== "haversine_mock") {
      await deps.redis.set(matrixKey(scenario), JSON.stringify(matrix), "EX", ROUTE_GAME_MATRIX_TTL_SECONDS);
    }
    deps.logger?.info(
      { scenarioId: scenario.id, provider: res.provider, elementsBilled: res.elementsBilled },
      "route_game_matrix_miss"
    );
    const info: RouteMatrixCacheInfo = { cache: "miss", provider: res.provider, elementsBilled: res.elementsBilled };
    return { matrix, info };
  }

  return {
    async get(scenario) {
      const raw = await deps.redis.get(matrixKey(scenario));
      if (raw) {
        try {
          const matrix = JSON.parse(raw) as CachedRouteMatrix;
          const n = scenario.pool.length;
          if (matrix.distKm.length === n && matrix.timeMin.length === n) {
            return { matrix, info: { cache: "hit", provider: matrix.provider, elementsBilled: 0 } };
          }
        } catch {
          // Valor corrupto: se vuelve a pedir.
        }
        deps.logger?.warn({ scenarioId: scenario.id }, "route_game_matrix_invalid_cache");
      }
      const key = matrixKey(scenario);
      let pending = inFlight.get(key);
      if (!pending) {
        pending = fetchAndCache(scenario).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      return pending;
    },
  };
}
