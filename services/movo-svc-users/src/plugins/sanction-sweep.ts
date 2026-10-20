import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { EmailProvider } from "../adapters/email-provider";
import { PushNotificationProvider } from "../adapters/push-notification-provider";
import { buildSanctionsService } from "../modules/sanctions/sanctions-internal.routes";

export interface SanctionSweepPluginOptions {
  emailProvider?: EmailProvider | undefined;
  pushProvider?: PushNotificationProvider | undefined;
  enabled?: boolean | undefined;
}

/**
 * MOVO-296: barrido periódico de las sanciones de cuenta. En cada pasada (1) cierra las
 * suspensiones vencidas (`active` + historial + aviso, AC7) y (2) reescribe la marca de Redis
 * de cada sanción vigente (AC6), porque Redis no es la fuente de verdad y pudo perder datos.
 * También corre una vez al arrancar el servicio, antes de quedar listo. Mismo esqueleto que
 * `orphan-photo-sweep.ts`: `setInterval` + lock distribuido en Redis para que, con varias
 * réplicas, corra una sola (ADR-006, sin infra de cron aparte).
 */
export default fp(async (app: FastifyInstance, opts: SanctionSweepPluginOptions = {}) => {
  const isEnabled = opts.enabled ?? app.config.SANCTION_SWEEP_ENABLED ?? true;
  const intervalMinutes = app.config.SANCTION_SWEEP_INTERVAL_MINUTES;

  if (!isEnabled || intervalMinutes <= 0) {
    app.log.info("Sanction sweep plugin está desactivado.");
    return;
  }

  const service = buildSanctionsService(app, { emailProvider: opts.emailProvider, pushProvider: opts.pushProvider });
  const intervalMs = intervalMinutes * 60 * 1000;
  // Menor al intervalo (80% o mín 10 s), así una réplica lenta no bloquea la corrida siguiente.
  const lockTtlMs = Math.max(10_000, Math.floor(intervalMs * 0.8));
  const lockKey = "locks:sanction-sweep";

  const reconcile = async () => {
    // Primero cerrar vencidas, después reescribir marcas: la reescritura ya no ve las cerradas.
    const expired = await service.expireDueSuspensions();
    const marks = await service.rewriteMarks();
    app.log.info({ event: "sanction_sweep_done", expired, marks }, "Barrido de sanciones de cuenta");
  };

  const runSweep = async () => {
    try {
      const acquired = await app.redis.set(lockKey, "locked", "PX", lockTtlMs, "NX");
      if (acquired !== "OK") {
        app.log.debug({ lockKey }, "Sweep omitido: otra instancia tiene el lock de Redis.");
        return;
      }
      await reconcile();
    } catch (err) {
      app.log.error({ err }, "Error inesperado durante el barrido de sanciones de cuenta");
    }
  };

  // AC6: al arrancar. Sin lock a propósito (ambas operaciones son idempotentes) y sin tirar el
  // servicio abajo si Redis o la DB no responden todavía: el próximo barrido lo reconcilia.
  app.addHook("onReady", async () => {
    try {
      await reconcile();
    } catch (err) {
      app.log.error({ err }, "No se pudo reconciliar las sanciones de cuenta al arrancar");
    }
  });

  const timer = setInterval(runSweep, intervalMs);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
});
