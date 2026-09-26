import { randomUUID } from "node:crypto";
import { FastifyBaseLogger } from "fastify";
import Redis from "ioredis";
import {
  AccountStatus,
  ApiError,
  BlockedUserSummary,
  MAX_REPORT_PHOTOS_PER_SUBMISSION,
  ReportPhotoUploadUrl,
  ReportReason,
} from "@movo/shared";
import { PrismaClient } from "../../generated/prisma/client";
import { StorageProvider } from "../../adapters/storage-provider";
import { createUserRepository } from "../../repositories/user-repository";
import {
  createModerationRepository,
  isReportPhotoKeyConflict,
  UserReportRecord,
} from "../../repositories/moderation-repository";

export const REPORT_RATE_LIMIT_MAX = 10;
export const REPORT_RATE_LIMIT_WINDOW_SECONDS = 24 * 60 * 60;

export function reportRateLimitKey(userId: string): string {
  return `user-report-attempts:${userId}`;
}

/** MOVO-256: sorted set de Redis con las keys de fotos de reporte presignadas y
 * todavía sin asociar (score = timestamp del presign). Candidato-list del sweep de
 * huérfanas -- Postgres (`user_report_photos`) sigue siendo la fuente de verdad. Mismo
 * esquema que `photos:pending:profile-photos` (MOVO-124). */
export const PENDING_REPORT_PHOTOS_REDIS_KEY = "photos:pending:reports";

/** MOVO-256: lock por key que se disputan la asociación de una foto a un reporte y el
 * sweep de huérfanas -- mismo motivo (TOCTOU entre "el sweep decide borrar" y "la
 * foto queda asociada") que `photoConfirmationLockKey` de la foto de perfil. */
export function reportPhotoLockKey(s3Key: string): string {
  return `locks:orphan-photo-sweep:key:reports:${s3Key}`;
}
export const REPORT_PHOTO_LOCK_TTL_MS = 5_000;

/** MOVO-256: JPEG y 2 MB, mismo criterio que la evidencia de envíos (MOVO-81): el
 * cliente comprime a JPEG antes de pedir la URL. Duplicado en `moderation.schema.ts`. */
const REPORT_PHOTO_CONTENT_TYPE = "image/jpeg";
const MAX_REPORT_PHOTO_BYTES = 2 * 1024 * 1024;

export interface ReportPhotoUploadInput {
  contentType: string;
  contentLength: number;
}

export interface ReportUserInput {
  reason: ReportReason;
  details?: string;
  /** Keys de S3 devueltas por el presign, ya subidas (MOVO-256). */
  photoKeys?: string[];
}

export interface AddReportEntryInput {
  details?: string;
  photoKeys?: string[];
}

function reportPhotoPrefix(reporterId: string): string {
  return `reports/${reporterId}/`;
}

function assertValidReportPhoto(contentType: string, contentLength: number): void {
  if (contentType !== REPORT_PHOTO_CONTENT_TYPE) {
    throw new ApiError(400, "VALIDATION_FAILED", "Tipo de imagen no permitido.");
  }
  if (contentLength <= 0 || contentLength > MAX_REPORT_PHOTO_BYTES) {
    throw new ApiError(400, "VALIDATION_FAILED", "El tamaño de la imagen supera el máximo permitido (2 MB).");
  }
}

/**
 * MOVO-175 (ADR-026): reportar y bloquear usuarios. El efecto del bloqueo sobre
 * envíos/ofertas vive en `svc-shipments`, que consulta `listRelatedUserIds` por el
 * endpoint interno -- acá solo se persiste la relación.
 */
export function createModerationService(
  db: PrismaClient,
  redis: Redis,
  storageProvider: StorageProvider,
  logger: FastifyBaseLogger,
) {
  const userRepository = createUserRepository(db);
  const repository = createModerationRepository(db);

  function assertNotSelf(callerId: string, targetId: string): void {
    if (callerId === targetId) {
      throw new ApiError(400, "CANNOT_MODERATE_SELF", "No podés reportarte ni bloquearte a vos mismo.");
    }
  }

  function reportAlreadyPending(): ApiError {
    return new ApiError(
      409,
      "REPORT_ALREADY_PENDING",
      "Ya tenés un reporte en revisión sobre este usuario. Podés sumarle información.",
    );
  }

  /** Mismo criterio que `getPublicProfile`: `deleted` se trata como "no existe". */
  async function assertModeratableTarget(callerId: string, targetId: string): Promise<void> {
    assertNotSelf(callerId, targetId);
    const target = await userRepository.findById(targetId);
    if (!target || target.status === AccountStatus.DELETED) {
      throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
    }
  }

  /** `SET NX EX` + `INCR`, mismo patrón que el rate limit de cambio de contraseña
   * (MOVO-134): la key nunca queda sin TTL aunque el proceso muera entre medio. */
  async function consumeReportQuota(reporterId: string): Promise<void> {
    const key = reportRateLimitKey(reporterId);
    const created = await redis.set(key, 1, "EX", REPORT_RATE_LIMIT_WINDOW_SECONDS, "NX");
    if (created) return;
    const count = await redis.incr(key);
    if (count > REPORT_RATE_LIMIT_MAX) {
      throw new ApiError(429, "RATE_LIMIT_EXCEEDED", "Hiciste demasiados reportes hoy. Probá de nuevo mañana.");
    }
  }

  /** `DECR` solo si la key sigue viva: si expiró entre medio, un `DECR` suelto la
   * recrearía en -1 y sin TTL. Atómico vía Lua, mismo motivo que `SET NX EX` arriba. */
  async function refundReportQuota(reporterId: string): Promise<void> {
    await redis.eval(
      "if redis.call('EXISTS', KEYS[1]) == 1 then return redis.call('DECR', KEYS[1]) end return 0",
      1,
      reportRateLimitKey(reporterId),
    );
  }

  /**
   * MOVO-256: toma el lock de cada key (el mismo que usa el sweep de huérfanas antes
   * de borrar) y valida que las fotos se puedan asociar: prefijo propio, objeto real
   * en S3 con tipo/tamaño permitidos, y que no estén ya en otro envío. Devuelve una
   * función que libera los locks -- quien llama la corre en un `finally` después de
   * persistir, así el sweep no puede borrar una foto entre la validación y el INSERT.
   */
  async function lockAndValidatePhotoKeys(reporterId: string, keys: string[]): Promise<() => Promise<void>> {
    if (keys.length === 0) return async () => {};
    if (new Set(keys).size !== keys.length) {
      throw new ApiError(400, "VALIDATION_FAILED", "Mandaste la misma foto más de una vez.");
    }
    if (keys.length > MAX_REPORT_PHOTOS_PER_SUBMISSION) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        `Podés mandar hasta ${MAX_REPORT_PHOTOS_PER_SUBMISSION} fotos por vez.`,
      );
    }
    const prefix = reportPhotoPrefix(reporterId);
    if (keys.some((key) => !key.startsWith(prefix))) {
      throw new ApiError(403, "PHOTO_FORBIDDEN_KEY", "La imagen no pertenece al usuario autenticado.");
    }

    const acquired: string[] = [];
    const release = async () => {
      if (acquired.length > 0) await redis.unlink(...acquired);
    };
    try {
      for (const key of keys) {
        const lockKey = reportPhotoLockKey(key);
        const ok = await redis.set(lockKey, "1", "PX", REPORT_PHOTO_LOCK_TTL_MS, "NX");
        if (ok !== "OK") {
          throw new ApiError(
            409,
            "PHOTO_CONFIRMATION_IN_PROGRESS",
            "Hay una verificación en curso para una de las imágenes, reintentá en unos segundos.",
          );
        }
        acquired.push(lockKey);
      }

      const [heads, associated] = await Promise.all([
        Promise.all(keys.map((key) => storageProvider.headObject(key))),
        repository.findAssociatedPhotoKeys(keys),
      ]);
      if (heads.some((head) => !head.exists)) {
        throw new ApiError(422, "PHOTO_OBJECT_NOT_FOUND", "Una de las imágenes no terminó de subirse.");
      }
      // Defensa en profundidad: revalida tipo/tamaño reales, no solo lo declarado al
      // presignar (mismo criterio que `confirmPhoto` de la foto de perfil).
      for (const head of heads) {
        if (head.contentType !== undefined && head.contentLength !== undefined) {
          assertValidReportPhoto(head.contentType, head.contentLength);
        }
      }
      if (associated.length > 0) {
        throw reportPhotoAlreadyUsed();
      }
      return release;
    } catch (error) {
      await release();
      throw error;
    }
  }

  function reportPhotoAlreadyUsed(): ApiError {
    return new ApiError(409, "REPORT_PHOTO_ALREADY_USED", "Una de las imágenes ya está en tu reporte.");
  }

  /** Best-effort, mismo criterio que `confirmPhoto`: si el ZREM falla, el sweep igual
   * revalida contra Postgres antes de borrar. */
  async function untrackPhotoKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await redis.zrem(PENDING_REPORT_PHOTOS_REDIS_KEY, ...keys);
    } catch (error) {
      logger.warn(
        { keys, event: "report_photo_untrack_failed", error: (error as Error).message },
        "No se pudo remover el tracking de Redis de las fotos del reporte",
      );
    }
  }

  return {
    /**
     * MOVO-256: presigned PUT para una foto de reporte. La key la genera siempre el
     * servidor, bajo el prefijo privado del reportante. No consume cupo diario: el
     * cupo lo consume el envío (reporte o entrada) en el que la foto se asocia.
     */
    async getReportPhotoUploadUrl(
      reporterId: string,
      reportedId: string,
      input: ReportPhotoUploadInput,
    ): Promise<ReportPhotoUploadUrl> {
      assertNotSelf(reporterId, reportedId);
      assertValidReportPhoto(input.contentType, input.contentLength);
      const s3Key = `${reportPhotoPrefix(reporterId)}${randomUUID()}.jpg`;
      const { uploadUrl, expiresIn } = await storageProvider.createUploadUrl({
        key: s3Key,
        contentType: input.contentType,
        contentLength: input.contentLength,
      });
      // Registra la key como pendiente para el sweep de huérfanas. Best-effort: si
      // Redis falla, la foto queda sin trackear (nunca se borra de más).
      try {
        await redis.zadd(PENDING_REPORT_PHOTOS_REDIS_KEY, Date.now(), s3Key);
      } catch (error) {
        logger.warn(
          { reporterId, s3Key, event: "report_photo_pending_track_failed", error: (error as Error).message },
          "No se pudo registrar la foto del reporte como pendiente en Redis",
        );
      }
      return { uploadUrl, s3Key, expiresIn };
    },

    /**
     * Un solo reporte `pending` por par. Si ya hay uno, 409 `REPORT_ALREADY_PENDING`
     * en vez de devolverlo como éxito: antes se respondía 200 con el reporte existente
     * y se descartaban sin avisar el motivo/detalle nuevos. Lo que el reportante quiera
     * agregar va por `addReportEntry`.
     */
    async reportUser(reporterId: string, reportedId: string, input: ReportUserInput): Promise<UserReportRecord> {
      await assertModeratableTarget(reporterId, reportedId);

      if (await repository.findPendingReport(reporterId, reportedId)) {
        throw reportAlreadyPending();
      }

      const photoKeys = input.photoKeys ?? [];
      // Las fotos se validan antes de consumir cupo: una foto rechazada no gasta cupo.
      const releasePhotoLocks = await lockAndValidatePhotoKeys(reporterId, photoKeys);
      try {
        await consumeReportQuota(reporterId);
        const details = input.details?.trim() ? input.details.trim() : null;
        // MOVO-175 (fix de review, PR #193): el cupo ya se consumió arriba -- cualquier
        // error del INSERT (no solo el P2002 esperado del índice único parcial, también
        // un timeout/error de conexión) tiene que reintegrarlo, o el cupo diario queda
        // gastado sin que se haya guardado nada.
        let report: UserReportRecord | null;
        try {
          report = await repository.createReport({
            reporterId,
            reportedId,
            reason: input.reason,
            details,
            photoKeys,
          });
        } catch (error) {
          await refundReportQuota(reporterId);
          if (isReportPhotoKeyConflict(error)) throw reportPhotoAlreadyUsed();
          throw error;
        }
        if (!report) {
          // Dos pedidos concurrentes pasaron los dos el `findPendingReport` de arriba y
          // el índice único parcial dejó entrar solo a uno: este no creó nada, así que
          // reintegra el cupo que consumió.
          await refundReportQuota(reporterId);
          throw reportAlreadyPending();
        }
        await untrackPhotoKeys(photoKeys);
        return report;
      } finally {
        await releasePhotoLocks();
      }
    },

    /** El reporte `pending` propio sobre `reportedId`, o `null`. Nunca expone reportes
     * de terceros. No valida que el target exista: el reporte sobrevive a la baja de
     * cuenta del reportado y el reportante lo puede seguir viendo. */
    async getPendingReport(reporterId: string, reportedId: string): Promise<UserReportRecord | null> {
      assertNotSelf(reporterId, reportedId);
      return repository.findPendingReport(reporterId, reportedId);
    },

    /** Suma información al reporte `pending` propio, sin editar lo ya enviado: texto,
     * fotos (MOVO-256) o ambos. Consume el mismo cupo diario que un reporte nuevo. */
    async addReportEntry(
      reporterId: string,
      reportedId: string,
      input: AddReportEntryInput,
    ): Promise<UserReportRecord> {
      assertNotSelf(reporterId, reportedId);
      const trimmed = input.details?.trim() ? input.details.trim() : null;
      const photoKeys = input.photoKeys ?? [];
      if (!trimmed && photoKeys.length === 0) {
        throw new ApiError(400, "VALIDATION_FAILED", "Escribí algo o sumá una foto.");
      }
      const pending = await repository.findPendingReport(reporterId, reportedId);
      if (!pending) {
        throw new ApiError(404, "REPORT_NOT_FOUND", "No tenés un reporte en revisión sobre este usuario.");
      }
      const releasePhotoLocks = await lockAndValidatePhotoKeys(reporterId, photoKeys);
      try {
        await consumeReportQuota(reporterId);
        // Mismo criterio que reportUser: si el INSERT falla por cualquier motivo, el
        // cupo ya consumido se reintegra en vez de perderse sin haber guardado nada.
        let entry;
        try {
          entry = await repository.addReportEntry(pending.id, trimmed, photoKeys);
        } catch (error) {
          await refundReportQuota(reporterId);
          if (isReportPhotoKeyConflict(error)) throw reportPhotoAlreadyUsed();
          throw error;
        }
        await untrackPhotoKeys(photoKeys);
        return { ...pending, entries: [...pending.entries, entry] };
      } finally {
        await releasePhotoLocks();
      }
    },

    async blockUser(blockerId: string, blockedId: string): Promise<void> {
      await assertModeratableTarget(blockerId, blockedId);
      await repository.block(blockerId, blockedId);
    },

    /** No valida que el target exista: desbloquear a una cuenta dada de baja (cuyas
     * filas ya se borraron en `deleteAccount`) es un no-op, no un 404. */
    async unblockUser(blockerId: string, blockedId: string): Promise<void> {
      assertNotSelf(blockerId, blockedId);
      await repository.unblock(blockerId, blockedId);
    },

    async listBlocked(blockerId: string): Promise<BlockedUserSummary[]> {
      return repository.listBlockedByUser(blockerId);
    },

    async listRelatedUserIds(userId: string): Promise<string[]> {
      return repository.listRelatedUserIds(userId);
    },
  };
}
