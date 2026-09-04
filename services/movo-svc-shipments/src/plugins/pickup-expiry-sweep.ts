import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createShipmentRepository } from "../repositories/shipment-repository";
import { createUsersClient, UsersClient } from "../adapters/users-client";
import { createNotificationsClient, NotificationsClient } from "../adapters/notifications-client";
import { createShipmentsService } from "../modules/shipments/shipments.service";

export interface PickupExpirySweepPluginOptions {
  usersClient?: UsersClient;
  notificationsClient?: NotificationsClient;
  enabled?: boolean;
}

/**
 * Barrido periódico que cancela envíos `published` cuya ventana de retiro venció sin
 * que ningún transportista lo tomara — mismo esqueleto que
 * `receiver-confirmation-sweep.ts` (MOVO-130): `setInterval` + lock distribuido en
 * Redis para no duplicar trabajo entre réplicas. Corrección directa sobre un bug
 * reportado (`GET /shipments/available` seguía devolviendo estos envíos como
 * disponibles), sin ticket propio.
 */
export default fp(async (app: FastifyInstance, opts: PickupExpirySweepPluginOptions = {}) => {
  const isEnabled = opts.enabled ?? app.config.PICKUP_EXPIRY_SWEEP_ENABLED ?? true;
  const intervalMinutes = app.config.PICKUP_EXPIRY_SWEEP_INTERVAL_MINUTES;

  if (!isEnabled || intervalMinutes <= 0) {
    app.log.info("Pickup expiry sweep plugin está desactivado.");
    return;
  }

  const repository = createShipmentRepository(app.db);
  const usersClient = opts.usersClient ?? createUsersClient(app.config);
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  const service = createShipmentsService(repository, usersClient, notificationsClient, app.log);

  const intervalMs = intervalMinutes * 60 * 1000;
  const lockTtlMs = Math.max(10_000, Math.floor(intervalMs * 0.8));
  const lockKey = "locks:pickup-expiry-sweep";

  const runSweep = async () => {
    try {
      const acquired = await app.redis.set(lockKey, "locked", "PX", lockTtlMs, "NX");
      if (acquired !== "OK") {
        app.log.debug({ lockKey }, "Sweep omitido: otra instancia tiene el lock de Redis.");
        return;
      }

      await service.expireOverduePublishedShipments();
    } catch (err) {
      app.log.error({ err }, "Error inesperado durante la ejecución del sweep de retiro vencido");
    }
  };

  const timer = setInterval(runSweep, intervalMs);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
});
