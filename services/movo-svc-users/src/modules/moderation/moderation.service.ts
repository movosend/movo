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

/**
 * MOVO-175 (ADR-026): reportar y bloquear usuarios. El efecto del bloqueo sobre
 * envíos/ofertas vive en `svc-shipments`, que consulta `listRelatedUserIds` por el
 * endpoint interno -- acá solo se persiste la relación.
 */
export function createModerationService(db: PrismaClient, redis: Redis) {
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

  return {
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
        });
      } catch (error) {
        await refundReportQuota(reporterId);
        throw error;
      }
      if (!report) {
        // Dos pedidos concurrentes pasaron los dos el `findPendingReport` de arriba y
        // el índice único parcial dejó entrar solo a uno: este no creó nada, así que
        // reintegra el cupo que consumió.
        await refundReportQuota(reporterId);
        throw reportAlreadyPending();
      }
      return report;
    },

    /** El reporte `pending` propio sobre `reportedId`, o `null`. Nunca expone reportes
     * de terceros. No valida que el target exista: el reporte sobrevive a la baja de
     * cuenta del reportado y el reportante lo puede seguir viendo. */
    async getPendingReport(reporterId: string, reportedId: string): Promise<UserReportRecord | null> {
      assertNotSelf(reporterId, reportedId);
      return repository.findPendingReport(reporterId, reportedId);
    },

    /** Suma información al reporte `pending` propio, sin editar lo ya enviado. Consume
     * el mismo cupo diario que un reporte nuevo. */
    async addReportEntry(reporterId: string, reportedId: string, details: string): Promise<UserReportRecord> {
      assertNotSelf(reporterId, reportedId);
      const trimmed = details.trim();
      if (!trimmed) {
        throw new ApiError(400, "VALIDATION_FAILED", "Escribí la información que querés sumar.");
      }
      const pending = await repository.findPendingReport(reporterId, reportedId);
      if (!pending) {
        throw new ApiError(404, "REPORT_NOT_FOUND", "No tenés un reporte en revisión sobre este usuario.");
      }
      await consumeReportQuota(reporterId);
      // Mismo criterio que reportUser: si el INSERT falla por cualquier motivo, el
      // cupo ya consumido se reintegra en vez de perderse sin haber guardado nada.
      let entry;
      try {
        entry = await repository.addReportEntry(pending.id, trimmed);
      } catch (error) {
        await refundReportQuota(reporterId);
        throw error;
      }
      return { ...pending, entries: [...pending.entries, entry] };
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
