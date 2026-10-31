import { PrismaClient, AdminDisputeNote as AdminDisputeNoteRow } from "../../generated/prisma/client";
import { AuditLogCursor } from "../audit/audit.repository";

export interface DisputeNotesRepository {
  /** Única escritura: la tabla es de solo agregar filas (trigger en la migración). */
  insert(note: { disputeId: string; adminId: string; body: string }): Promise<AdminDisputeNoteRow>;
  /** De la más reciente a la más vieja, keyset sobre `(createdAt, id)` como la bitácora. */
  list(disputeId: string, limit: number, cursor?: AuditLogCursor): Promise<AdminDisputeNoteRow[]>;
}

export function createDisputeNotesRepository(db: PrismaClient): DisputeNotesRepository {
  return {
    insert(note) {
      // En ms, lo fija la app: mismo motivo que `audit.repository.ts` (el cursor viaja en ms).
      return db.adminDisputeNote.create({ data: { ...note, createdAt: new Date() } });
    },

    list(disputeId, limit, cursor) {
      return db.adminDisputeNote.findMany({
        where: {
          disputeId,
          ...(cursor
            ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
    },
  };
}
