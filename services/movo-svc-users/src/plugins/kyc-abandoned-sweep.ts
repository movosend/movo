import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { KycStatus } from "@movo/shared";
import { PrismaClient } from "../generated/prisma/client";
import { createKycVerificationRepository } from "../repositories/kyc-verification-repository";
import { createUserRepository } from "../repositories/user-repository";
import { VerificationType } from "../models/kyc-verification";

export interface KycAbandonedSweepPluginOptions {
  enabled?: boolean | undefined;
}

export interface KycAbandonedPurgeResult {
  deleted: number;
  cacheReset: number;
}

const VERIFICATION_TYPES: readonly VerificationType[] = ["identity", "license"];

/**
 * MOVO-230 (Política de Privacidad §7, "registros incompletos"): borra los intentos de KYC
 * que nunca llegaron a un resultado y se pidieron antes de `cutoff`. Una sesión de Didit no
 * vive tanto, así que nada en curso se pierde. Si el intento borrado seguía `pending`, el
 * caché de `users` vuelve a `not_started`: `createSession` deja un solo `pending` por
 * usuario y tipo (`kyc.service.ts`), así que ese caché apuntaba justo a la fila borrada.
 */
export async function purgeAbandonedKycAttempts(
  db: PrismaClient,
  cutoff: Date,
): Promise<KycAbandonedPurgeResult> {
  return db.$transaction(async (tx) => {
    const attempts = await createKycVerificationRepository(tx).deleteAbandonedBefore(cutoff);
    const userRepository = createUserRepository(tx);
    let cacheReset = 0;
    for (const verificationType of VERIFICATION_TYPES) {
      const userIds = attempts
        .filter((attempt) => attempt.verificationType === verificationType && attempt.status === KycStatus.PENDING)
        .map((attempt) => attempt.userId);
      cacheReset += await userRepository.resetPendingKycStatus([...new Set(userIds)], verificationType);
    }
    return { deleted: attempts.length, cacheReset };
  });
}

/**
 * Mismo esqueleto que `sanction-sweep.ts`: `setInterval` + lock distribuido en Redis para que,
 * con varias réplicas, corra una sola (ADR-006, sin infra de cron aparte).
 */
export default fp(async (app: FastifyInstance, opts: KycAbandonedSweepPluginOptions = {}) => {
  const isEnabled = opts.enabled ?? app.config.KYC_ABANDONED_SWEEP_ENABLED ?? true;
  const intervalMinutes = app.config.KYC_ABANDONED_SWEEP_INTERVAL_MINUTES;

  if (!isEnabled || intervalMinutes <= 0) {
    app.log.info("KYC abandoned sweep plugin está desactivado.");
    return;
  }

  const retentionMs = app.config.KYC_ABANDONED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const intervalMs = intervalMinutes * 60 * 1000;
  // Menor al intervalo (80% o mín 10 s), así una réplica lenta no bloquea la corrida siguiente.
  const lockTtlMs = Math.max(10_000, Math.floor(intervalMs * 0.8));
  const lockKey = "locks:kyc-abandoned-sweep";

  const runSweep = async () => {
    try {
      const acquired = await app.redis.set(lockKey, "locked", "PX", lockTtlMs, "NX");
      if (acquired !== "OK") {
        app.log.debug({ lockKey }, "Sweep omitido: otra instancia tiene el lock de Redis.");
        return;
      }
      const result = await purgeAbandonedKycAttempts(app.db, new Date(Date.now() - retentionMs));
      app.log.info({ event: "kyc_abandoned_sweep_done", ...result }, "Purga de intentos de KYC abandonados");
    } catch (err) {
      app.log.error({ err }, "Error inesperado durante la purga de intentos de KYC abandonados");
    }
  };

  const timer = setInterval(runSweep, intervalMs);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
});
