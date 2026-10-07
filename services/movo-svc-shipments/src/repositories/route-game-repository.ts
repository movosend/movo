import { Prisma, PrismaClient } from "../generated/prisma/client";
import { RouteGameComputedBy, RouteGameScore, RouteGameSessionRecord } from "../models/route-game";
import { RankingRow } from "../domain/route-game";

/**
 * Juego del optimizador de la feria: persistencia de partidas
 * (`shipments.route_game_sessions`). Upsert por `id` (lo genera el servidor al crear la
 * partida): el iPad la manda al terminar la carrera y otra vez al anotarse en el
 * ranking, y la cola offline puede reenviarla.
 *
 * El primer `PUT` fija el resultado. Los siguientes solo pueden sumar nombre y mail: el
 * primero ya devolvió `optimalOrder`, así que repuntuar dejaría reenviar el óptimo (o un
 * `timeUsedSec` menor) para subir en el ranking. Tampoco vuelven a meter al ranking una
 * partida que sacó el reset del stand (`rankingHiddenAt`).
 */
export interface RouteGameRepository {
  /** Devuelve el resultado que quedó guardado, que en un reenvío es el del primer `PUT`. */
  upsertSession(record: RouteGameSessionRecord): Promise<{ created: boolean; score: RouteGameScore }>;
  /** Partidas anotadas en el ranking desde `since` para un evento. */
  listRanking(eventTag: string, since: Date, limit: number): Promise<RankingRow[]>;
  /** Saca del ranking las partidas desde `since` (botón del modo stand). */
  hideFromRanking(eventTag: string, since: Date): Promise<number>;
}

const dec = (value: number) => new Prisma.Decimal(value);

const EXISTING_SELECT = {
  computedBy: true,
  userKm: true,
  optimalKm: true,
  userMin: true,
  optimalMin: true,
  extraKm: true,
  extraMin: true,
  efficiencyPct: true,
  tie: true,
  optimalOrder: true,
  distanceMethod: true,
  inRanking: true,
  rankingHiddenAt: true,
} as const;

type ExistingRow = Prisma.RouteGameSessionGetPayload<{ select: typeof EXISTING_SELECT }>;

function scoreOf(r: RouteGameScore): RouteGameScore {
  return {
    computedBy: r.computedBy,
    userKm: r.userKm,
    optimalKm: r.optimalKm,
    userMin: r.userMin,
    optimalMin: r.optimalMin,
    extraKm: r.extraKm,
    extraMin: r.extraMin,
    efficiencyPct: r.efficiencyPct,
    tie: r.tie,
    optimalOrder: r.optimalOrder,
    distanceMethod: r.distanceMethod,
  };
}

function scoreFromRow(row: ExistingRow): RouteGameScore {
  return {
    computedBy: row.computedBy as RouteGameComputedBy,
    userKm: row.userKm.toNumber(),
    optimalKm: row.optimalKm.toNumber(),
    userMin: row.userMin.toNumber(),
    optimalMin: row.optimalMin.toNumber(),
    extraKm: row.extraKm.toNumber(),
    extraMin: row.extraMin.toNumber(),
    efficiencyPct: row.efficiencyPct.toNumber(),
    tie: row.tie,
    optimalOrder: row.optimalOrder as number[],
    distanceMethod: row.distanceMethod,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function toRow(r: RouteGameSessionRecord) {
  return {
    eventTag: r.eventTag,
    deviceId: r.deviceId,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    scenarioId: r.scenarioId,
    city: r.city,
    points: r.points as unknown as Prisma.InputJsonValue,
    stopCount: r.stopCount,
    userOrder: r.userOrder,
    optimalOrder: r.optimalOrder,
    userKm: dec(r.userKm),
    optimalKm: dec(r.optimalKm),
    extraKm: dec(r.extraKm),
    userMin: dec(r.userMin),
    optimalMin: dec(r.optimalMin),
    extraMin: dec(r.extraMin),
    efficiencyPct: dec(r.efficiencyPct),
    tie: r.tie,
    timeUsedSec: r.timeUsedSec,
    timeLimitSec: r.timeLimitSec,
    timedOut: r.timedOut,
    distanceMethod: r.distanceMethod,
    computedBy: r.computedBy,
    name: r.name,
    inRanking: r.inRanking,
    email: r.email,
    userAgent: r.userAgent,
  };
}

export function createRouteGameRepository(db: PrismaClient): RouteGameRepository {
  const repository: RouteGameRepository = {
    async upsertSession(record) {
      const existing = await db.routeGameSession.findUnique({ where: { id: record.id }, select: EXISTING_SELECT });
      if (!existing) {
        try {
          await db.routeGameSession.create({ data: { id: record.id, ...toRow(record) } });
          return { created: true, score: scoreOf(record) };
        } catch (error) {
          // Dos PUT simultáneos de la misma partida (cola offline + reintento): el que
          // pierde la carrera sigue como reenvío.
          if (!isUniqueViolation(error)) throw error;
          return repository.upsertSession(record);
        }
      }

      await db.routeGameSession.update({
        where: { id: record.id },
        data: {
          // Un reenvío sin nombre o sin mail (el primer PUT que la cola manda tarde) no
          // borra lo que se cargó al anotarse.
          ...(record.name != null && { name: record.name }),
          ...(record.email != null && { email: record.email }),
          inRanking:
            existing.inRanking ||
            (record.inRanking && existing.rankingHiddenAt == null && existing.computedBy === "server"),
        },
      });
      return { created: false, score: scoreFromRow(existing) };
    },

    async listRanking(eventTag, since, limit) {
      const rows = await db.routeGameSession.findMany({
        where: { eventTag, inRanking: true, endedAt: { gte: since } },
        orderBy: [{ efficiencyPct: "desc" }, { timeUsedSec: "asc" }, { endedAt: "asc" }],
        take: limit,
        select: { id: true, name: true, efficiencyPct: true, timeUsedSec: true, endedAt: true },
      });
      return rows.map((row) => ({ ...row, efficiencyPct: row.efficiencyPct.toNumber() }));
    },

    async hideFromRanking(eventTag, since) {
      const hiddenAt = new Date();
      // Se marcan también las partidas del día todavía sin nombre: si después llega su
      // PUT de "anotarme", no entran a un ranking que ya se reinició.
      const [{ count }] = await db.$transaction([
        db.routeGameSession.updateMany({
          where: { eventTag, inRanking: true, endedAt: { gte: since } },
          data: { inRanking: false, rankingHiddenAt: hiddenAt },
        }),
        db.routeGameSession.updateMany({
          where: { eventTag, rankingHiddenAt: null, endedAt: { gte: since } },
          data: { rankingHiddenAt: hiddenAt },
        }),
      ]);
      return count;
    },
  };
  return repository;
}
