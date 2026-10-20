import { PrismaClient, AdminUserNote as AdminUserNoteRow } from "../../generated/prisma/client";
import { AuditLogCursor } from "../audit/audit.repository";

export interface NotesRepository {
  /** Única escritura: la tabla es de solo agregar filas (trigger en la migración). */
  insert(note: { userId: string; adminId: string; body: string }): Promise<AdminUserNoteRow>;
  /** De la más reciente a la más vieja, keyset sobre `(createdAt, id)` como la bitácora. */
  list(userId: string, limit: number, cursor?: AuditLogCursor): Promise<AdminUserNoteRow[]>;
}

export function createNotesRepository(db: PrismaClient): NotesRepository {
  return {
    insert(note) {
      // En ms, lo fija la app: mismo motivo que `audit.repository.ts` (el cursor viaja en ms).
      return db.adminUserNote.create({ data: { ...note, createdAt: new Date() } });
    },

    list(userId, limit, cursor) {
      return db.adminUserNote.findMany({
        where: {
          userId,
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
