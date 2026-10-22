import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";
import { createShipmentRepository } from "../repositories/shipment-repository";
import { createOfferRepository } from "../repositories/offer-repository";
import { createUsersClient } from "../adapters/users-client";
import { createPaymentsClient, PaymentsClient } from "../adapters/payments-client";
import { createShipmentsService } from "../modules/shipments/shipments.service";

export interface SettlementSweepPluginOptions {
  enabled?: boolean;
  paymentsClient?: PaymentsClient;
}

/**
 * MOVO-212: reintenta la captura de los envíos `delivered` que no llegaron a `completed`
 * (la captura en línea del handshake es best-effort: un corte de MP o de `svc-payments` la
 * deja pendiente). Un intento por envío y por pasada; un envío que falla se "enfría" (10 min, 20,
 * 40... hasta 6 h, 24 h si el fallo es permanente) para que los que nunca se van a poder capturar
 * no tapen a los demás. El backoff persistido y el escalado manual son de svc-payments (MOVO-213); este barrido es la red de seguridad. Solo corre con `FUNDS_RELEASE_NOTIFIER=payments`:
 * con el notifier de consola (dev/test/CI) no hay nada que cobrar.
 */
export default fp(async (app: FastifyInstance, opts: SettlementSweepPluginOptions = {}) => {
  const service = app.settlements;
  const shipments = createShipmentsService(
    createShipmentRepository(app.db), createUsersClient(app.config), undefined, app.log,
    {
      offerRepository: createOfferRepository(app.db),
      paymentsClient: opts.paymentsClient ?? createPaymentsClient(app.config),
      registerWithdrawalPenalty: (offerId) => service.registerWithdrawalPenalty(offerId),
    }
  );

  registerSweep(app, {
    name: "Settlement sweep plugin",
    lockKey: "locks:settlement-sweep",
    enabled: (opts.enabled ?? app.config.SETTLEMENT_SWEEP_ENABLED ?? true) && app.config.FUNDS_RELEASE_NOTIFIER === "payments",
    intervalMinutes: app.config.SETTLEMENT_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante el sweep de liquidaciones",
    // MOVO-307: después de las entregas, las penalidades de cancelación que quedaron `pending`.
    // Si las entregas fallan de forma inesperada, las penalidades corren igual.
    run: async () => {
      await shipments.retryPendingCarrierWithdrawals();
      const options = {
        graceMinutes: app.config.SETTLEMENT_SWEEP_GRACE_MINUTES,
        batchSize: app.config.SETTLEMENT_SWEEP_BATCH_SIZE,
      };
      try {
        await service.retryPendingSettlements(options);
      } finally {
        try {
          await service.retryPendingPenalties(options);
        } finally {
          // MOVO-310: penalidades de bajas del transportista que no se registraron en línea.
          await service.retryPendingWithdrawalPenalties(options);
        }
      }
    },
  });
});
