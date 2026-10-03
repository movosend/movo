import { Prisma, PrismaClient } from "../generated/prisma/client";
import { RouteGameSessionRecord } from "../models/route-game";
import { RankingRow } from "../domain/route-game";

/**
 * Juego del optimizador de la feria: persistencia de partidas
 * (`shipments.route_game_sessions`). Upsert por `id` (lo genera el servidor al crear la
 * partida): el iPad la manda al terminar la carrera y otra vez al anotarse en el
 * ranking, y la cola offline puede reenviarla.
 */
export interface RouteGameRepository {
  upsertSession(record: RouteGameSessionRecord): Promise<{ created: boolean }>;
  /** Partidas anotadas en el ranking desde `since` para un evento. */
  listRanking(eventTag: string, since: Date, limit: number): Promise<RankingRow[]>;
  /** Saca del ranking las partidas desde `since` (botón del modo stand). */
  hideFromRanking(eventTag: string, since: Date): Promise<number>;
}

const dec = (value: number) => new Prisma.Decimal(value);

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
  return {
    async upsertSession(record) {
      const data = toRow(record);
      const existing = await db.routeGameSession.findUnique({ where: { id: record.id }, select: { id: true } });
      await db.routeGameSession.upsert({
        where: { id: record.id },
        create: { id: record.id, ...data },
        update: data,
      });
      return { created: !existing };
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
      const { count } = await db.routeGameSession.updateMany({
        where: { eventTag, inRanking: true, endedAt: { gte: since } },
        data: { inRanking: false },
      });
      return count;
    },
  };
}
