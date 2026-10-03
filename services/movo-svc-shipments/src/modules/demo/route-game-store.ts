import type Redis from "ioredis";
import { RouteMatrix } from "../../domain/route-game";
import { RouteGamePoints } from "../../models/route-game";

/**
 * Partidas creadas del juego del optimizador. Guarda el óptimo y la submatriz para que,
 * al registrar la partida, los km del jugador se midan con la misma matriz que usó
 * OR-Tools y no con lo que mande el iPad. Una hora cubre la partida (~2 min) más la cola
 * offline de un iPad sin red un rato; si vence, la partida se guarda igual con los
 * números del cliente (`computedBy: client`). No se consume al leer: el reenvío de la
 * misma partida tiene que dar el mismo resultado.
 */
export const ROUTE_GAME_TTL_SECONDS = 60 * 60;

const gameKey = (gameId: string) => `route_game:${gameId}`;

export interface StoredRouteGame {
  scenarioId: string;
  city: string;
  points: RouteGamePoints;
  /** Submatriz `[salida, paradas..., llegada]`. */
  matrix: RouteMatrix;
  optimalOrder: number[];
  optimalKm: number;
  optimalMin: number;
  calculationMethod: string;
}

export interface RouteGameStore {
  save(gameId: string, game: StoredRouteGame): Promise<void>;
  get(gameId: string): Promise<StoredRouteGame | null>;
}

export function createRouteGameStore(redis: Pick<Redis, "set" | "get">): RouteGameStore {
  return {
    async save(gameId, game) {
      await redis.set(gameKey(gameId), JSON.stringify(game), "EX", ROUTE_GAME_TTL_SECONDS);
    },

    async get(gameId) {
      const raw = await redis.get(gameKey(gameId));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StoredRouteGame;
      } catch {
        return null;
      }
    },
  };
}
