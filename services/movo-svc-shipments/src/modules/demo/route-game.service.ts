import { randomUUID } from "node:crypto";
import { ApiError } from "@movo/shared";
import {
  argentinaDayStart,
  buildRanking,
  initialOrder,
  isPermutation,
  Ranking,
  routeCost,
  scoreRoute,
  shuffle,
  subMatrix,
} from "../../domain/route-game";
import { RouteGamePoint, RouteGamePoints, RouteGameSessionRecord } from "../../models/route-game";
import { PricingLogisticsClient } from "../../adapters/pricing-logistics-client";
import { RouteGameRepository } from "../../repositories/route-game-repository";
import { RouteGameMatrixStore, RouteMatrixCacheInfo } from "./route-game-matrix-store";
import { RouteGameStore } from "./route-game-store";
import {
  findScenario,
  ROUTE_GAME_SCENARIOS,
  RouteGamePlace,
  RouteGameScenario,
} from "./route-game.scenarios";
import { DEFAULT_EVENT_TAG } from "./pricing-game.service";

/** Tope de partidas del día que se leen para el ranking: una feria son cientos. */
export const RANKING_MAX_ROWS = 5_000;

export interface RouteGameCreateInput {
  stopCount: number;
  /** Ciudad de la partida anterior del iPad, para no repetirla seguido. */
  lastScenarioId?: string;
}

export interface RouteGameCreateResult {
  gameId: string;
  scenarioId: string;
  city: string;
  zone: string;
  start: RouteGamePoint;
  end: RouteGamePoint;
  stops: RouteGamePoint[];
  /** Orden inicial de las tarjetas (índices de `stops`), nunca igual al óptimo. */
  initialOrder: number[];
  matrix: RouteMatrixCacheInfo;
}

/** Números de una partida jugada sin red (el iPad no pudo crearla en el servidor). */
export interface RouteGameOfflineInput {
  scenarioId: string;
  city: string;
  points: RouteGamePoints;
  optimalOrder: number[];
  userKm: number;
  optimalKm: number;
  userMin: number;
  optimalMin: number;
  distanceMethod: string;
}

/** Body de `PUT /demo/route-game/games/:id`: el `record()` del prototipo. */
export interface RouteGameSaveInput {
  eventTag?: string;
  deviceId?: string;
  startedAt: string;
  endedAt: string;
  userOrder: number[];
  timeUsedSec: number;
  timeLimitSec?: number | null;
  timedOut: boolean;
  /** Con nombre la partida entra al ranking del día. */
  name?: string | null;
  email?: string | null;
  emailConsent?: boolean;
  userAgent?: string | null;
  offline?: RouteGameOfflineInput;
}

export interface RouteGameSaveResult {
  id: string;
  created: boolean;
  computedBy: "server" | "client";
  userKm: number;
  optimalKm: number;
  userMin: number;
  optimalMin: number;
  extraKm: number;
  extraMin: number;
  efficiencyPct: number;
  tie: boolean;
  optimalOrder: number[];
  distanceMethod: string | null;
}

export interface RouteGameService {
  createGame(input: RouteGameCreateInput): Promise<RouteGameCreateResult>;
  saveGame(id: string, input: RouteGameSaveInput): Promise<RouteGameSaveResult>;
  ranking(eventTag?: string, gameId?: string): Promise<Ranking>;
  resetRanking(eventTag?: string): Promise<{ hidden: number }>;
}

export interface RouteGameServiceDeps {
  pricingLogisticsClient: Pick<PricingLogisticsClient, "optimizeRoute">;
  matrixStore: RouteGameMatrixStore;
  gameStore: RouteGameStore;
  repository: RouteGameRepository;
  random?: () => number;
  now?: () => Date;
}

const toPoint = ([name, zone, lat, lng]: RouteGamePlace): RouteGamePoint => ({ name, zone, lat, lng });

export function createRouteGameService(deps: RouteGameServiceDeps): RouteGameService {
  const random = deps.random ?? Math.random;
  const now = deps.now ?? (() => new Date());

  function pickScenario(lastScenarioId?: string): RouteGameScenario {
    const options = ROUTE_GAME_SCENARIOS.filter((s) => s.id !== lastScenarioId);
    const pool = options.length ? options : ROUTE_GAME_SCENARIOS;
    return pool[Math.floor(random() * pool.length)];
  }

  return {
    async createGame({ stopCount, lastScenarioId }) {
      const scenario = pickScenario(lastScenarioId);
      // Índices del pool: [salida, paradas..., llegada].
      const indices = shuffle(
        scenario.pool.map((_, i) => i),
        random
      ).slice(0, stopCount + 2);
      const [start, ...rest] = indices.map((i) => toPoint(scenario.pool[i]));
      const end = rest.pop() as RouteGamePoint;
      const stops = rest;

      const { matrix: cityMatrix, info } = await deps.matrixStore.get(scenario);
      const matrix = subMatrix(cityMatrix, indices);

      // OR-Tools sobre la submatriz (sin volver a consultar Google), minimizando km: el
      // juego compara distancias. Sin tiempo de servicio: el jugador tampoco lo ve.
      const optimized = await deps.pricingLogisticsClient.optimizeRoute({
        carrierLocation: { lat: start.lat, lng: start.lng },
        finalLocation: { lat: end.lat, lng: end.lng },
        stops: stops.map((s, i) => ({
          shipmentId: String(i),
          type: "delivery",
          lat: s.lat,
          lng: s.lng,
          serviceTimeMinutes: 0,
        })),
        objective: "distance",
        matrix,
      });
      const optimalOrder = optimized.stops.map((s) => Number(s.shipmentId));
      if (!isPermutation(optimalOrder, stopCount)) {
        throw new ApiError(503, "ROUTING_SERVICE_UNAVAILABLE", "El optimizador devolvió una ruta incompleta.");
      }
      const optimal = routeCost(matrix, optimalOrder);

      const gameId = randomUUID();
      await deps.gameStore.save(gameId, {
        scenarioId: scenario.id,
        city: scenario.city,
        points: { start, stops, end },
        matrix,
        optimalOrder,
        optimalKm: optimal.km,
        optimalMin: optimal.min,
        calculationMethod: `${cityMatrix.provider}_vrptw_distance`,
      });

      return {
        gameId,
        scenarioId: scenario.id,
        city: scenario.city,
        zone: scenario.zone,
        start,
        end,
        stops,
        initialOrder: initialOrder(stopCount, optimalOrder, random),
        matrix: info,
      };
    },

    async saveGame(id, input) {
      const stored = await deps.gameStore.get(id);
      let base: Omit<RouteGameSessionRecord, "id" | keyof ReturnType<typeof commonFields>>;
      let computedBy: "server" | "client";

      if (stored) {
        if (!isPermutation(input.userOrder, stored.optimalOrder.length)) {
          throw new ApiError(400, "VALIDATION_FAILED", "El orden de paradas no corresponde a la partida.");
        }
        const score = scoreRoute(routeCost(stored.matrix, input.userOrder), {
          km: stored.optimalKm,
          min: stored.optimalMin,
        });
        computedBy = "server";
        base = {
          scenarioId: stored.scenarioId,
          city: stored.city,
          points: stored.points,
          stopCount: stored.optimalOrder.length,
          optimalOrder: stored.optimalOrder,
          optimalKm: stored.optimalKm,
          optimalMin: stored.optimalMin,
          distanceMethod: stored.calculationMethod,
          computedBy,
          ...score,
        };
      } else if (input.offline) {
        const o = input.offline;
        const n = o.points.stops.length;
        if (!findScenario(o.scenarioId) || !isPermutation(input.userOrder, n) || !isPermutation(o.optimalOrder, n)) {
          throw new ApiError(400, "VALIDATION_FAILED", "La partida offline no es válida.");
        }
        const score = scoreRoute({ km: o.userKm, min: o.userMin }, { km: o.optimalKm, min: o.optimalMin });
        computedBy = "client";
        base = {
          scenarioId: o.scenarioId,
          city: o.city,
          points: o.points,
          stopCount: n,
          optimalOrder: o.optimalOrder,
          optimalKm: o.optimalKm,
          optimalMin: o.optimalMin,
          distanceMethod: o.distanceMethod,
          computedBy,
          ...score,
        };
      } else {
        throw new ApiError(404, "ROUTE_GAME_NOT_FOUND", "La partida venció o no existe.");
      }

      const record: RouteGameSessionRecord = { id, ...commonFields(input), ...base };
      const { created } = await deps.repository.upsertSession(record);
      return {
        id,
        created,
        computedBy,
        userKm: record.userKm,
        optimalKm: record.optimalKm,
        userMin: record.userMin,
        optimalMin: record.optimalMin,
        extraKm: record.extraKm,
        extraMin: record.extraMin,
        efficiencyPct: record.efficiencyPct,
        tie: record.tie,
        optimalOrder: record.optimalOrder,
        distanceMethod: record.distanceMethod,
      };
    },

    async ranking(eventTag, gameId) {
      const rows = await deps.repository.listRanking(
        eventTag || DEFAULT_EVENT_TAG,
        argentinaDayStart(now()),
        RANKING_MAX_ROWS
      );
      return buildRanking(rows, gameId);
    },

    async resetRanking(eventTag) {
      const hidden = await deps.repository.hideFromRanking(eventTag || DEFAULT_EVENT_TAG, argentinaDayStart(now()));
      return { hidden };
    },
  };
}

function commonFields(input: RouteGameSaveInput) {
  const name = input.name?.trim() || null;
  return {
    eventTag: input.eventTag || DEFAULT_EVENT_TAG,
    deviceId: input.deviceId ?? null,
    startedAt: new Date(input.startedAt),
    endedAt: new Date(input.endedAt),
    userOrder: input.userOrder,
    timeUsedSec: input.timeUsedSec,
    timeLimitSec: input.timeLimitSec ?? null,
    timedOut: input.timedOut,
    name,
    inRanking: name != null,
    // Solo con consentimiento explícito (sorteo + newsletter).
    email: input.emailConsent && input.email ? input.email.trim().toLowerCase() : null,
    userAgent: input.userAgent ?? null,
  };
}
