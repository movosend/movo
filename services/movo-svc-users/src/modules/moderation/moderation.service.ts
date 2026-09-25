import Redis from "ioredis";
import { AccountStatus, ApiError, BlockedUserSummary, ReportReason } from "@movo/shared";
import { PrismaClient } from "../../generated/prisma/client";
import { createUserRepository } from "../../repositories/user-repository";
import { createModerationRepository, UserReportRecord } from "../../repositories/moderation-repository";

export const REPORT_RATE_LIMIT_MAX = 10;
export const REPORT_RATE_LIMIT_WINDOW_SECONDS = 24 * 60 * 60;

export function reportRateLimitKey(userId: string): string {
  return `user-report-attempts:${userId}`;
}

export interface ReportUserInput {
  reason: ReportReason;
  details?: string;
}

export interface ReportUserResult {
  report: UserReportRecord;
  /** `false` si ya existía un reporte `pending` del mismo par (reintento idempotente). */
  created: boolean;
}

/**
 * MOVO-175 (ADR-026): reportar y bloquear usuarios. El efecto del bloqueo sobre
 * envíos/ofertas vive en `svc-shipments`, que consulta `listRelatedUserIds` por el
 * endpoint interno -- acá solo se persiste la relación.
 */
export function createModerationService(db: PrismaClient, redis: Redis) {
  const userRepository = createUserRepository(db);
  const repository = createModerationRepository(db);

  /** Mismo criterio que `getPublicProfile`: `deleted` se trata como "no existe". */
  async function assertModeratableTarget(callerId: string, targetId: string): Promise<void> {
    if (callerId === targetId) {
      throw new ApiError(400, "CANNOT_MODERATE_SELF", "No podés reportarte ni bloquearte a vos mismo.");
    }
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

  return {
    async reportUser(reporterId: string, reportedId: string, input: ReportUserInput): Promise<ReportUserResult> {
      await assertModeratableTarget(reporterId, reportedId);

      // Un reporte pendiente por par: reintentar (doble tap, reintento tras timeout)
      // devuelve el mismo reporte sin consumir cupo ni duplicar la fila.
      const pending = await repository.findPendingReport(reporterId, reportedId);
      if (pending) {
        return { report: pending, created: false };
      }

      await consumeReportQuota(reporterId);
      const details = input.details?.trim() ? input.details.trim() : null;
      const report = await repository.createReport({
        reporterId,
        reportedId,
        reason: input.reason,
        details,
      });
      return { report, created: true };
    },

    async blockUser(blockerId: string, blockedId: string): Promise<void> {
      await assertModeratableTarget(blockerId, blockedId);
      await repository.block(blockerId, blockedId);
    },

    /** No valida que el target exista: desbloquear a una cuenta dada de baja (cuyas
     * filas ya se borraron en `deleteAccount`) es un no-op, no un 404. */
    async unblockUser(blockerId: string, blockedId: string): Promise<void> {
      if (blockerId === blockedId) {
        throw new ApiError(400, "CANNOT_MODERATE_SELF", "No podés reportarte ni bloquearte a vos mismo.");
      }
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
