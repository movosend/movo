import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
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
 * MOVO-258 (D4): barrido periódico que marca para revisión (nunca cancela) los envíos
 * `in_transit` que pasaron su entrega estimada más el 50% de la duración estimada, y le
 * pregunta al transportista si tuvo un inconveniente. Misma estructura que
 * `pickup-missed-sweep.ts`; la regla vive en
 * `shipments.service.ts#flagAnomalousInTransitShipments`.
 */
export default fp(async (app: FastifyInstance, opts: TransitAnomalySweepPluginOptions = {}) => {
  const isEnabled = opts.enabled ?? app.config.TRANSIT_ANOMALY_SWEEP_ENABLED ?? true;
  const intervalMinutes = app.config.TRANSIT_ANOMALY_SWEEP_INTERVAL_MINUTES;

  if (!isEnabled || intervalMinutes <= 0) {
    app.log.info("Transit anomaly sweep plugin está desactivado.");
    return;
  }

  const repository = createShipmentRepository(app.db);
  const usersClient = opts.usersClient ?? createUsersClient(app.config);
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  const service = createShipmentsService(repository, usersClient, notificationsClient, app.log, {
    transitAnomalyFallbackHours: app.config.IN_TRANSIT_ANOMALY_FALLBACK_HOURS,
  });

  const intervalMs = intervalMinutes * 60 * 1000;
  const lockTtlMs = Math.max(10_000, Math.floor(intervalMs * 0.8));
  const lockKey = "locks:transit-anomaly-sweep";

  const runSweep = async () => {
    try {
      const acquired = await app.redis.set(lockKey, "locked", "PX", lockTtlMs, "NX");
      if (acquired !== "OK") {
        app.log.debug({ lockKey }, "Sweep omitido: otra instancia tiene el lock de Redis.");
        return;
      }

      await service.flagAnomalousInTransitShipments();
    } catch (err) {
      app.log.error({ err }, "Error inesperado durante el sweep de envíos en tránsito anómalos");
    }
  };

  const timer = setInterval(runSweep, intervalMs);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
});
