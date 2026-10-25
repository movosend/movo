import { AdminTargetType, AuditLogEntry, AuditOutcome } from "@movo/shared";
import { Prisma, PrismaClient, AuditLog as AuditLogRow } from "../../generated/prisma/client";

export interface NewAuditLogEntry {
  adminId: string;
  action: string;
  targetType: AdminTargetType;
  targetId: string;
  reason?: string | null;
  context?: Record<string, unknown> | null;
  outcome: AuditOutcome;
  errorCode?: string | null;
  requestId?: string | null;
}

export interface AuditLogFilters {
  adminId?: string;
  action?: string;
  targetType?: AdminTargetType;
  targetId?: string;
}

export interface AuditLogCursor {
  createdAt: Date;
  id: string;
}

export interface AuditRepository {
  /** Única escritura: la tabla es de solo agregar filas (trigger en la migración). */
  insert(entry: NewAuditLogEntry): Promise<AuditLogEntry>;
  /** Del más reciente al más viejo, keyset sobre `(createdAt, id)`. */
  list(filters: AuditLogFilters, limit: number, cursor?: AuditLogCursor): Promise<AuditLogEntry[]>;
  /**
   * MOVO-299: filas de las acciones `actions` sobre el usuario cuyo `context.sanctionId` es uno de
   * `sanctionIds`, de la más reciente a la más vieja. Para saber cómo quedó el retiro de cada sanción.
   * Sin límite a propósito: el retiro suma todos los intentos, y el volumen lo acota `targetId` (pocas
   * sanciones por usuario, uno o dos intentos por sanción). No reusar para listados de otro volumen.
   */
  listBySanction(userId: string, sanctionIds: string[], actions: readonly string[]): Promise<AuditLogEntry[]>;
}

function toEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    adminId: row.adminId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    context: (row.context as Record<string, unknown> | null) ?? null,
    outcome: row.outcome,
    errorCode: row.errorCode,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createAuditRepository(db: PrismaClient): AuditRepository {
  return {
    async insert(entry) {
      const row = await db.auditLog.create({
        data: {
          adminId: entry.adminId,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          reason: entry.reason ?? null,
          context: entry.context ? (entry.context as Prisma.InputJsonObject) : Prisma.DbNull,
          outcome: entry.outcome,
          errorCode: entry.errorCode ?? null,
          requestId: entry.requestId ?? null,
          // Lo fija la app en ms, no `now()` de Postgres (µs): con µs el cursor, que viaja
          // en ms, saltearía filas del mismo milisegundo (mismo gotcha que el chat, MOVO-26).
          createdAt: new Date(),
        },
      });
      return toEntry(row);
    },

    async list(filters, limit, cursor) {
      const rows = await db.auditLog.findMany({
        where: {
          ...(filters.adminId ? { adminId: filters.adminId } : {}),
          ...(filters.action ? { action: filters.action } : {}),
          ...(filters.targetType ? { targetType: filters.targetType } : {}),
          ...(filters.targetId ? { targetId: filters.targetId } : {}),
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      return rows.map(toEntry);
    },

    async listBySanction(userId, sanctionIds, actions) {
      if (sanctionIds.length === 0) return [];
      const rows = await db.auditLog.findMany({
        where: {
          targetType: "user",
          targetId: userId,
          action: { in: [...actions] },
          OR: sanctionIds.map((sanctionId) => ({ context: { path: ["sanctionId"], equals: sanctionId } })),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return rows.map(toEntry);
    },
  };
}
