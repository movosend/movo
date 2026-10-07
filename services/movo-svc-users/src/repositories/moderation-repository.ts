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
  /** Fotos mandadas con el reporte original (MOVO-256). */
  photos: UserReportPhotoRecord[];
  /** Información sumada después (MOVO-175), de la más vieja a la más nueva. */
  entries: UserReportEntryRecord[];
}

export interface UserReportEntryRecord {
  id: string;
  /** `null` si la entrada es solo fotos (MOVO-256). */
  details: string | null;
  createdAt: Date;
  photos: UserReportPhotoRecord[];
}

export interface UserReportPhotoRecord {
  id: string;
  s3Key: string;
  createdAt: Date;
}

export interface CreateReportInput {
  reporterId: string;
  reportedId: string;
  reason: ReportReason;
  details: string | null;
  /** Keys de S3 ya subidas y validadas por el service (MOVO-256). */
  photoKeys: string[];
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
  addReportEntry(reportId: string, details: string | null, photoKeys: string[]): Promise<UserReportEntryRecord>;
  /** De `keys`, las que ya están asociadas a algún reporte o entrada (MOVO-256). */
  findAssociatedPhotoKeys(keys: string[]): Promise<string[]>;
  /** Fuente de verdad del sweep de huérfanas (MOVO-256, mismo rol que `existsByPhotoUrl`). */
  existsReportPhotoByS3Key(s3Key: string): Promise<boolean>;
}

/** Mismo criterio que `isDefaultUniqueConflict` de `address-repository.ts`: el único
 * índice único de `user_reports` es el parcial de reportes `pending`, así que cualquier
 * P2002 en `createReport()` viene de ahí. */
function isPendingReportConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    !isReportPhotoKeyConflict(error)
  );
}

/**
 * MOVO-256: P2002 del índice único `user_report_photos_s3_key_key` -- dos envíos
 * concurrentes con la misma key pasaron los dos el chequeo previo del service. La
 * forma de `meta` depende del driver adapter (Prisma 7 con `@prisma/adapter-pg` la
 * anida bajo `driverAdapterError`), así que se busca el nombre de la columna en todo
 * el objeto en vez de atarse a una ruta puntual.
 */
export function isReportPhotoKeyConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    JSON.stringify(error.meta ?? {}).includes("s3_key")
  );
}

const PHOTOS_ORDER = { orderBy: { createdAt: "asc" } } satisfies Prisma.UserReportPhotoFindManyArgs;

const WITH_ENTRIES = {
  // Solo las del reporte original: las de cada entrada vienen anidadas en esa entrada.
  photos: { where: { entryId: null }, ...PHOTOS_ORDER },
  entries: { orderBy: { createdAt: "asc" }, include: { photos: PHOTOS_ORDER } },
} satisfies Prisma.UserReportInclude;

function toDomainPhoto(row: Prisma.UserReportPhotoGetPayload<Record<string, never>>): UserReportPhotoRecord {
  return { id: row.id, s3Key: row.s3Key, createdAt: row.createdAt };
}

function toDomainEntry(
  row: Prisma.UserReportEntryGetPayload<{ include: { photos: typeof PHOTOS_ORDER } }>,
): UserReportEntryRecord {
  return { id: row.id, details: row.details, createdAt: row.createdAt, photos: row.photos.map(toDomainPhoto) };
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
    photos: row.photos.map(toDomainPhoto),
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

    async createReport({ photoKeys, ...input }) {
      try {
        // Nested create: el reporte y sus fotos entran en la misma transacción.
        const row = await db.userReport.create({
          data: { ...input, photos: { create: photoKeys.map((s3Key) => ({ s3Key })) } },
          include: WITH_ENTRIES,
        });
        return toDomainReport(row);
      } catch (error) {
        if (isPendingReportConflict(error)) return null;
        throw error;
      }
    },

    async addReportEntry(reportId, details, photoKeys) {
      const row = await db.userReportEntry.create({
        data: { reportId, details, photos: { create: photoKeys.map((s3Key) => ({ s3Key, reportId })) } },
        include: { photos: PHOTOS_ORDER },
      });
      return toDomainEntry(row);
    },

    async findAssociatedPhotoKeys(keys) {
      if (keys.length === 0) return [];
      const rows = await db.userReportPhoto.findMany({ where: { s3Key: { in: keys } }, select: { s3Key: true } });
      return rows.map((row) => row.s3Key);
    },

    async existsReportPhotoByS3Key(s3Key) {
      const row = await db.userReportPhoto.findUnique({ where: { s3Key }, select: { id: true } });
      return row !== null;
    },
  };
}
