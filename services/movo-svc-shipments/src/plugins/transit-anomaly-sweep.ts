import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";
import { createShipmentRepository } from "../repositories/shipment-repository";
import { createUsersClient, UsersClient } from "../adapters/users-client";
import { createNotificationsClient, NotificationsClient } from "../adapters/notifications-client";
import { createShipmentsService } from "../modules/shipments/shipments.service";

export interface TransitAnomalySweepPluginOptions {
  usersClient?: UsersClient;
  notificationsClient?: NotificationsClient;
  enabled?: boolean;
}

/**
 * MOVO-278 (DD-045): además de marcar, avisa al transportista a las
 * `IN_TRANSIT_ANOMALY_WARN_AFTER_HOURS` de la marca y pasa el envío a `disputed` a las
 * `IN_TRANSIT_ANOMALY_DISPUTE_AFTER_HOURS`.
 *
 * MOVO-258 (D4): barrido periódico que marca para revisión (nunca cancela) los envíos
 * `in_transit` que pasaron su entrega estimada más el 50% de la duración estimada, y le
 * pregunta al transportista si tuvo un inconveniente. Misma estructura que
 * `pickup-missed-sweep.ts`; la regla vive en
 * `shipments.service.ts#flagAnomalousInTransitShipments`.
 */
export default fp(async (app: FastifyInstance, opts: TransitAnomalySweepPluginOptions = {}) => {
  const repository = createShipmentRepository(app.db);
  const usersClient = opts.usersClient ?? createUsersClient(app.config);
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  const warnAfterHours = app.config.IN_TRANSIT_ANOMALY_WARN_AFTER_HOURS;
  const disputeAfterHours = app.config.IN_TRANSIT_ANOMALY_DISPUTE_AFTER_HOURS;
  // MOVO-278 (DD-045): un aviso que llega después (o junto con) la disputa no avisa nada.
  if (warnAfterHours >= disputeAfterHours) {
    throw new Error(
      `IN_TRANSIT_ANOMALY_WARN_AFTER_HOURS (${warnAfterHours}) tiene que ser menor que IN_TRANSIT_ANOMALY_DISPUTE_AFTER_HOURS (${disputeAfterHours})`
    );
  }
  const service = createShipmentsService(repository, usersClient, notificationsClient, app.log, {
    transitAnomalyFallbackHours: app.config.IN_TRANSIT_ANOMALY_FALLBACK_HOURS,
    transitAnomalyWarnAfterHours: warnAfterHours,
    transitAnomalyDisputeAfterHours: disputeAfterHours,
  });

  registerSweep(app, {
    name: "Transit anomaly sweep plugin",
    lockKey: "locks:transit-anomaly-sweep",
    enabled: opts.enabled ?? app.config.TRANSIT_ANOMALY_SWEEP_ENABLED ?? true,
    intervalMinutes: app.config.TRANSIT_ANOMALY_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante el sweep de envíos en tránsito anómalos",
    run: async () => {
      // Cada paso por separado: una falla en uno no frena a los otros (mismo criterio que
      // `trip-expiry-sweep.ts#runStep`).
      const steps: Array<[string, () => Promise<unknown>]> = [
        ["flag", () => service.flagAnomalousInTransitShipments()],
        ["warn", () => service.warnFlaggedInTransitShipments()],
        ["dispute", () => service.disputeOverdueFlaggedShipments()],
      ];
      for (const [step, run] of steps) {
        try {
          await run();
        } catch (err) {
          app.log.error({ err, step, event: "transit_anomaly_sweep_step_error" }, "Error en un paso del sweep de envíos en tránsito anómalos");
        }
      }
    },
  });
});
