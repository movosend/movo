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
  const service = createShipmentsService(repository, usersClient, notificationsClient, app.log, {
    transitAnomalyFallbackHours: app.config.IN_TRANSIT_ANOMALY_FALLBACK_HOURS,
  });

  registerSweep(app, {
    name: "Transit anomaly sweep plugin",
    lockKey: "locks:transit-anomaly-sweep",
    enabled: opts.enabled ?? app.config.TRANSIT_ANOMALY_SWEEP_ENABLED ?? true,
    intervalMinutes: app.config.TRANSIT_ANOMALY_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante el sweep de envíos en tránsito anómalos",
    run: async () => {
      await service.flagAnomalousInTransitShipments();
    },
  });
});
