import { Prisma } from "../generated/prisma/client";
import { isTourId, TourId, TourOutcome, UserTourRecord } from "@movo/shared";

export interface UserTourRepository {
  /** Solo tours vigentes en `TOUR_IDS` -- una fila de un tour retirado no se expone. */
  listByUserId(userId: string): Promise<UserTourRecord[]>;
  /**
   * Upsert por `(userId, tourId)` (MOVO-169) que **nunca baja la versión**: si ya hay
   * un registro con una versión mayor (una instalación vieja de la app reportando un
   * tour que la nueva ya registró en una versión posterior), no se toca y se devuelve
   * el vigente -- si no, el tour nuevo reaparecería en la app nueva. Repetir el mismo
   * request deja el mismo estado (idempotente).
   */
  record(userId: string, tourId: TourId, version: number, outcome: TourOutcome): Promise<UserTourRecord>;
}

/** El usuario del `x-user-id` no existe (FK de `user_tour.user_id`). */
export class UserTourUserNotFoundError extends Error {}

function toRecord(row: { tourId: string; version: number; outcome: TourOutcome }): UserTourRecord {
  return { tourId: row.tourId as TourId, version: row.version, outcome: row.outcome };
}

function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

export function createUserTourRepository(db: Prisma.TransactionClient): UserTourRepository {
  async function tryRecord(
    userId: string,
    tourId: TourId,
    version: number,
    outcome: TourOutcome
  ): Promise<UserTourRecord> {
    const data = { version, outcome, recordedAt: new Date() };
    const { count } = await db.userTour.updateMany({
      // Un request idéntico al vigente no matchea: conserva `recordedAt` (idempotente).
      where: { userId, tourId, OR: [{ version: { lt: version } }, { version, outcome: { not: outcome } }] },
      data,
    });
    if (count === 0) {
      const current = await db.userTour.findUnique({ where: { userId_tourId: { userId, tourId } } });
      if (current) return toRecord(current);
      const created = await db.userTour.create({ data: { userId, tourId, ...data } });
      return toRecord(created);
    }
    return { tourId, version, outcome };
  }

  return {
    async listByUserId(userId: string): Promise<UserTourRecord[]> {
      const rows = await db.userTour.findMany({
        where: { userId },
        select: { tourId: true, version: true, outcome: true },
        orderBy: { tourId: "asc" },
      });
      return rows.filter((row) => isTourId(row.tourId)).map(toRecord);
    },

    async record(userId: string, tourId: TourId, version: number, outcome: TourOutcome): Promise<UserTourRecord> {
      try {
        return await tryRecord(userId, tourId, version, outcome);
      } catch (error) {
        if (isPrismaError(error, "P2003")) throw new UserTourUserNotFoundError();
        // Dos PUT simultáneos del primer registro: el `create` que pierde la carrera
        // choca con la PK, y para entonces la fila ya existe -- un reintento cae en
        // el `updateMany`.
        if (isPrismaError(error, "P2002")) return tryRecord(userId, tourId, version, outcome);
        throw error;
      }
    },
  };
}
