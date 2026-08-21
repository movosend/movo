import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createShipmentRepository } from "../repositories/shipment-repository";
import { createUsersClient, UsersClient } from "../adapters/users-client";
import { createNotificationsClient, NotificationsClient } from "../adapters/notifications-client";
import { createShipmentsService } from "../modules/shipments/shipments.service";

export interface ReceiverConfirmationSweepPluginOptions {
  usersClient?: UsersClient;
  notificationsClient?: NotificationsClient;
  enabled?: boolean;
}

export default fp(async (app: FastifyInstance, opts: ReceiverConfirmationSweepPluginOptions = {}) => {
  const isEnabled = opts.enabled ?? app.config.RECEIVER_CONFIRMATION_SWEEP_ENABLED ?? true;
  const intervalMinutes = app.config.RECEIVER_CONFIRMATION_SWEEP_INTERVAL_MINUTES;

  if (!isEnabled || intervalMinutes <= 0) {
    app.log.info("Receiver confirmation sweep plugin está desactivado.");
    return;
  }

  const repository = createShipmentRepository(app.db);
  const usersClient = opts.usersClient ?? createUsersClient(app.config);
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  const service = createShipmentsService(repository, usersClient, notificationsClient, app.log, {
    receiverConfirmationTimeoutHours: app.config.RECEIVER_CONFIRMATION_TIMEOUT_HOURS,
  });

  const intervalMs = intervalMinutes * 60 * 1000;
  // TTL del lock: menor al intervalo (80% del intervalo o mín 10s) para evitar ejecuciones concurrentes en réplicas
  const lockTtlMs = Math.max(10_000, Math.floor(intervalMs * 0.8));
  const lockKey = "locks:receiver-confirmation-sweep";

  const runSweep = async () => {
    try {
      const acquired = await app.redis.set(lockKey, "locked", "PX", lockTtlMs, "NX");
      if (acquired !== "OK") {
        app.log.debug({ lockKey }, "Sweep omitido: otra instancia tiene el lock de Redis.");
        return;
      }

      await service.expireOverdueShipments();
    } catch (err) {
      app.log.error({ err }, "Error inesperado durante la ejecución del sweep de confirmación de receptor");
    }
  };

  const timer = setInterval(runSweep, intervalMs);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
});
