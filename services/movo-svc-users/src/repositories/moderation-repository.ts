import { AccountStatus as PrismaAccountStatus, Prisma } from "../generated/prisma/client";
import { BlockedUserSummary, ReportReason, ReportStatus } from "@movo/shared";
import { fullName } from "../models/user";

export interface UserReportRecord {
  id: string;
  reporterId: string;
  reportedId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  createdAt: Date;
  /** Información sumada después (MOVO-175), de la más vieja a la más nueva. */
  entries: UserReportEntryRecord[];
}

export interface UserReportEntryRecord {
  id: string;
  details: string;
  createdAt: Date;
}

export interface CreateReportInput {
  reporterId: string;
  reportedId: string;
  reason: ReportReason;
  details: string | null;
}

/** MOVO-175 (ADR-026): bloqueos y reportes entre usuarios. */
export interface ModerationRepository {
  /** Idempotente: bloquear dos veces al mismo usuario no crea una segunda fila. */
  block(blockerId: string, blockedId: string): Promise<void>;
  /** Idempotente: desbloquear a alguien no bloqueado no falla. */
  unblock(blockerId: string, blockedId: string): Promise<void>;
  /** Solo la dirección `blockerId -> blockedId` (el `isBlockedByMe` del perfil). */
  isBlockedBy(blockerId: string, blockedId: string): Promise<boolean>;
  /** Bloqueos hechos por `blockerId`, del más reciente al más viejo, sin cuentas `deleted`. */
  listBlockedByUser(blockerId: string): Promise<BlockedUserSummary[]>;
  /**
   * Unión de las dos direcciones (a quién bloqueó `userId` + quién bloqueó a
   * `userId`) -- acá se resuelve la simetría del bloqueo (ADR-026). Es lo que
   * consumen la búsqueda de usuarios y `svc-shipments`.
   */
  listRelatedUserIds(userId: string): Promise<string[]>;
  findPendingReport(reporterId: string, reportedId: string): Promise<UserReportRecord | null>;
  /** `null` si ya hay un reporte `pending` del mismo par (índice único parcial
   * `user_reports_reporter_id_reported_id_pending_key`): otro pedido concurrente ganó. */
  createReport(input: CreateReportInput): Promise<UserReportRecord | null>;
  /** Append-only: el reporte original nunca se edita. */
  addReportEntry(reportId: string, details: string): Promise<UserReportEntryRecord>;
}

/** Mismo criterio que `isDefaultUniqueConflict` de `address-repository.ts`: el único
 * índice único de `user_reports` es el parcial de reportes `pending`, así que cualquier
 * P2002 en `createReport()` viene de ahí. */
function isPendingReportConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const WITH_ENTRIES = { entries: { orderBy: { createdAt: "asc" } } } satisfies Prisma.UserReportInclude;

function toDomainEntry(row: Prisma.UserReportEntryGetPayload<Record<string, never>>): UserReportEntryRecord {
  return { id: row.id, details: row.details, createdAt: row.createdAt };
}

function toDomainReport(row: Prisma.UserReportGetPayload<{ include: typeof WITH_ENTRIES }>): UserReportRecord {
  return {
    id: row.id,
    reporterId: row.reporterId,
    reportedId: row.reportedId,
    reason: row.reason as ReportReason,
    details: row.details,
    status: row.status as ReportStatus,
    createdAt: row.createdAt,
    entries: row.entries.map(toDomainEntry),
  };
}

export function createModerationRepository(db: Prisma.TransactionClient): ModerationRepository {
  return {
    async block(blockerId, blockedId) {
      await db.userBlock.createMany({ data: [{ blockerId, blockedId }], skipDuplicates: true });
    },

    async unblock(blockerId, blockedId) {
      await db.userBlock.deleteMany({ where: { blockerId, blockedId } });
    },

    async isBlockedBy(blockerId, blockedId) {
      const row = await db.userBlock.findUnique({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        select: { id: true },
      });
      return row !== null;
    },

    async listBlockedByUser(blockerId) {
      const rows = await db.userBlock.findMany({
        where: { blockerId, blocked: { status: { not: PrismaAccountStatus.deleted } } },
        include: { blocked: { select: { id: true, firstName: true, lastName: true, photoUrl: true } } },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => ({
        id: row.blocked.id,
        fullName: fullName(row.blocked),
        photoUrl: row.blocked.photoUrl,
        blockedAt: row.createdAt.toISOString(),
      }));
    },

    async listRelatedUserIds(userId) {
      const rows = await db.userBlock.findMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
        select: { blockerId: true, blockedId: true },
      });
      const ids = new Set<string>();
      for (const row of rows) {
        ids.add(row.blockerId === userId ? row.blockedId : row.blockerId);
      }
      return [...ids];
    },

    async findPendingReport(reporterId, reportedId) {
      const row = await db.userReport.findFirst({
        where: { reporterId, reportedId, status: "pending" },
        orderBy: { createdAt: "desc" },
        include: WITH_ENTRIES,
      });
      return row ? toDomainReport(row) : null;
    },

    async createReport(input) {
      try {
        const row = await db.userReport.create({ data: input, include: WITH_ENTRIES });
        return toDomainReport(row);
      } catch (error) {
        if (isPendingReportConflict(error)) return null;
        throw error;
      }
    },

    async addReportEntry(reportId, details) {
      const row = await db.userReportEntry.create({ data: { reportId, details } });
      return toDomainEntry(row);
    },
  };
}
