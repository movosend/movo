import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";

export interface SettlementSweepPluginOptions {
  enabled?: boolean;
}

/**
 * MOVO-212: reintenta la captura de los envíos `delivered` que no llegaron a `completed`
 * (la captura en línea del handshake es best-effort: un corte de MP o de `svc-payments` la
 * deja pendiente). Un intento por envío y por pasada; un envío que falla se "enfría" (10 min, 20,
 * 40... hasta 6 h, 24 h si el fallo es permanente) para que los que nunca se van a poder capturar
 * no tapen a los demás. La política completa de reintentos y el escalado manual son de MOVO-213. Solo corre con `FUNDS_RELEASE_NOTIFIER=payments`:
 * con el notifier de consola (dev/test/CI) no hay nada que cobrar.
 */
export default fp(async (app: FastifyInstance, opts: SettlementSweepPluginOptions = {}) => {
  const service = app.settlements;

  registerSweep(app, {
    name: "Settlement sweep plugin",
    lockKey: "locks:settlement-sweep",
    enabled: (opts.enabled ?? app.config.SETTLEMENT_SWEEP_ENABLED ?? true) && app.config.FUNDS_RELEASE_NOTIFIER === "payments",
    intervalMinutes: app.config.SETTLEMENT_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante el sweep de liquidaciones",
    // MOVO-307: después de las entregas, las penalidades de cancelación que quedaron `pending`.
    // Si las entregas fallan de forma inesperada, las penalidades corren igual.
    run: async () => {
      const options = {
        graceMinutes: app.config.SETTLEMENT_SWEEP_GRACE_MINUTES,
        batchSize: app.config.SETTLEMENT_SWEEP_BATCH_SIZE,
      };
      try {
        await service.retryPendingSettlements(options);
      } finally {
        await service.retryPendingPenalties(options);
      }
    },
  });
});
