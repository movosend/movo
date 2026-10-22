import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createSettlementRepository } from "../repositories/settlement-repository";
import { createCaptureRetryService } from "../modules/settlements/capture-retry.service";
import { registerSweep } from "./register-sweep";

export interface CaptureRetrySweepPluginOptions {
  enabled?: boolean;
}

/**
 * MOVO-213: barrido que reintenta las capturas fallidas (backoff persistido en `settlements.next_attempt_at`).
 * Va después de `capturesPlugin` (usa `app.captures`) y de `shipmentsClientPlugin`.
 */
export default fp(async (app: FastifyInstance, opts: CaptureRetrySweepPluginOptions = {}) => {
  const service = createCaptureRetryService({
    settlements: createSettlementRepository(app.db),
    captures: app.captures,
    log: app.log,
    onCredited: async (shipmentId) => {
      await app.shipmentsClient.notifySettlementEvent(shipmentId, "credited");
    },
  });
  app.decorate("captureRetry", service);

  registerSweep(app, {
    name: "Capture retry sweep plugin",
    lockKey: "locks:capture-retry-sweep",
    enabled: opts.enabled ?? app.config.SETTLEMENT_RETRY_SWEEP_ENABLED,
    intervalMinutes: app.config.SETTLEMENT_RETRY_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante el reintento de capturas fallidas",
    run: async () => {
      await service.runOnce();
    },
  });
});

declare module "fastify" {
  interface FastifyInstance {
    captureRetry: ReturnType<typeof createCaptureRetryService>;
  }
}
