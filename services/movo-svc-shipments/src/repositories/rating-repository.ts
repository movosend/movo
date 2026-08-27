import { PrismaClient, Rating as RatingRow } from "../generated/prisma/client";
import { Rating, CreateRatingInput, RatingRole, parseRatingRole } from "../models/rating";

/**
 * MOVO-147: proyección mínima para el cálculo de reputación -- estructuralmente un
 * superset de `RatingForReputation` (`domain/reputation.ts`, solo `score`/`createdAt`),
 * con `role` sumado para que `ratings.service.ts` arme los tres buckets (global/
 * asSender/asCarrier) sin una segunda query.
 */
export interface RatingRowForReputation {
  score: number;
  createdAt: Date;
  role: RatingRole;
}

function mapRating(row: RatingRow): Rating {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    raterId: row.raterId,
    rateeId: row.rateeId,
    role: parseRatingRole(row.role),
    score: row.score,
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

function isUniqueRatingConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * AC2: la unicidad real vive en el constraint de base
 * (`ratings_shipment_rater_ratee_key`) -- esto solo traduce la violación (Postgres
 * `23505`, Prisma `P2002`) a un error de dominio legible, mismo patrón que
 * `DuplicateActiveOfferError` en `offer-repository.ts`.
 */
export class DuplicateRatingError extends Error {
  constructor(
    public readonly shipmentId: string,
    public readonly raterId: string,
    public readonly rateeId: string,
  ) {
    super(`Ya existe una calificación de '${raterId}' a '${rateeId}' para el envío '${shipmentId}'`);
    this.name = "DuplicateRatingError";
  }
}

export interface RatingRepository {
  create(input: CreateRatingInput): Promise<Rating>;
  /** AC5: edita la fila existente -- el caller (`ratings.service.ts`) ya verificó que
   * existe antes de llamar, no hay chequeo de "no encontrado" acá. */
  update(shipmentId: string, raterId: string, rateeId: string, score: number, comment?: string): Promise<Rating>;
  findByPair(shipmentId: string, raterId: string, rateeId: string): Promise<Rating | null>;
  /** AC6: calificaciones de un envío, para que sus participantes vean a quién ya calificaron. */
  listByShipment(shipmentId: string): Promise<Rating[]>;
  /** AC10: últimas `limit` calificaciones RECIBIDAS por un usuario, más reciente primero. */
  listRecentByRatee(rateeId: string, limit: number): Promise<Rating[]>;
  /**
   * MOVO-147 AC1/AC6: proyección mínima (`score`/`createdAt`/`role`) de TODAS las
   * calificaciones recibidas por `rateeId`, para que `reputation.ts` aplique
   * shrinkage+decaimiento. Acotado a un único usuario (no es "traer toda la tabla
   * `ratings` a memoria", eso es justo lo que AC6 prohíbe) -- el decaimiento necesita
   * `createdAt` por fila, así que no se resuelve como un agregado SQL puro; el
   * `ratingCount`/desglose por rol de la respuesta sale de este mismo array
   * (`.length`/`.filter`), sin una segunda query de conteo.
   */
  listForReputation(rateeId: string): Promise<RatingRowForReputation[]>;
  /**
   * MOVO-147 AC1: `m`, la media global de calificaciones de la plataforma -- un solo
   * `AVG` en SQL (AC6: nunca se traen todas las filas de `ratings` de todos los
   * usuarios a JS solo para promediarlas). Solo se llama cuando el `rateeId` en
   * cuestión ya tiene alguna calificación propia (`ratings.service.ts`), así que la
   * tabla nunca puede estar vacía en ese momento -- el fallback a 0 es defensivo, no
   * alcanzable en producción.
   */
  getGlobalAverageScore(): Promise<number>;
}

export function createRatingRepository(db: PrismaClient): RatingRepository {
  return {
    async create(input: CreateRatingInput): Promise<Rating> {
      try {
        const row = await db.rating.create({
          data: {
            shipmentId: input.shipmentId,
            raterId: input.raterId,
            rateeId: input.rateeId,
            role: input.role,
            score: input.score,
            comment: input.comment ?? null,
          },
        });
        return mapRating(row);
      } catch (error) {
        if (isUniqueRatingConflict(error)) {
          throw new DuplicateRatingError(input.shipmentId, input.raterId, input.rateeId);
        }
        throw error;
      }
    },

    async update(
      shipmentId: string,
      raterId: string,
      rateeId: string,
      score: number,
      comment?: string,
    ): Promise<Rating> {
      const row = await db.rating.update({
        where: { shipmentId_raterId_rateeId: { shipmentId, raterId, rateeId } },
        data: { score, comment: comment ?? null },
      });
      return mapRating(row);
    },

    async findByPair(shipmentId: string, raterId: string, rateeId: string): Promise<Rating | null> {
      const row = await db.rating.findUnique({
        where: { shipmentId_raterId_rateeId: { shipmentId, raterId, rateeId } },
      });
      return row ? mapRating(row) : null;
    },

    async listByShipment(shipmentId: string): Promise<Rating[]> {
      const rows = await db.rating.findMany({ where: { shipmentId }, orderBy: { createdAt: "asc" } });
      return rows.map(mapRating);
    },

    async listRecentByRatee(rateeId: string, limit: number): Promise<Rating[]> {
      const rows = await db.rating.findMany({
        where: { rateeId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return rows.map(mapRating);
    },

    async listForReputation(rateeId: string): Promise<RatingRowForReputation[]> {
      const rows = await db.rating.findMany({
        where: { rateeId },
        select: { score: true, createdAt: true, role: true },
      });
      return rows.map((row) => ({ ...row, role: parseRatingRole(row.role) }));
    },

    async getGlobalAverageScore(): Promise<number> {
      const result = await db.rating.aggregate({ _avg: { score: true } });
      return result._avg.score ?? 0;
    },
  };
}
