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
  createReport(input: CreateReportInput): Promise<UserReportRecord>;
}

function toDomainReport(row: Prisma.UserReportGetPayload<Record<string, never>>): UserReportRecord {
  return {
    id: row.id,
    reporterId: row.reporterId,
    reportedId: row.reportedId,
    reason: row.reason as ReportReason,
    details: row.details,
    status: row.status as ReportStatus,
    createdAt: row.createdAt,
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
      });
      return row ? toDomainReport(row) : null;
    },

    async createReport(input) {
      const row = await db.userReport.create({ data: input });
      return toDomainReport(row);
    },
  };
}
