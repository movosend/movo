import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";
import { NotificationsClient } from "../adapters/notifications-client";
import { PaymentsClient } from "../adapters/payments-client";
import { buildSettlementService } from "../modules/settlements/settlements.routes";

export interface SettlementSweepPluginOptions {
  notificationsClient?: NotificationsClient;
  paymentsClient?: PaymentsClient;
  enabled?: boolean;
}

/**
 * MOVO-212: reintenta la captura de los envíos `delivered` que no llegaron a `completed`
 * (la captura en línea del handshake es best-effort: un corte de MP o de `svc-payments` la
 * deja pendiente). Un intento por envío y por pasada, sin backoff: la política de reintentos
 * y el escalado manual son de MOVO-213. Solo corre con `FUNDS_RELEASE_NOTIFIER=payments`:
 * con el notifier de consola (dev/test/CI) no hay nada que cobrar.
 */
export default fp(async (app: FastifyInstance, opts: SettlementSweepPluginOptions = {}) => {
  const service = buildSettlementService(app, opts);

  registerSweep(app, {
    name: "Settlement sweep plugin",
    lockKey: "locks:settlement-sweep",
    enabled: (opts.enabled ?? app.config.SETTLEMENT_SWEEP_ENABLED ?? true) && app.config.FUNDS_RELEASE_NOTIFIER === "payments",
    intervalMinutes: app.config.SETTLEMENT_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante el sweep de liquidaciones",
    run: () =>
      service.retryPendingSettlements({
        graceMinutes: app.config.SETTLEMENT_SWEEP_GRACE_MINUTES,
        batchSize: app.config.SETTLEMENT_SWEEP_BATCH_SIZE,
      }),
  });
});
