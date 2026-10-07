import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";
import { createShipmentRepository } from "../repositories/shipment-repository";
import { createOfferRepository } from "../repositories/offer-repository";
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
 * que ningún transportista lo tomara (salvo que sigan teniendo ofertas vigentes, D6) — mismo esqueleto que
 * `receiver-confirmation-sweep.ts` (MOVO-130): `setInterval` + lock distribuido en
 * Redis para no duplicar trabajo entre réplicas. Corrección directa sobre un bug
 * reportado (`GET /shipments/available` seguía devolviendo estos envíos como
 * disponibles), sin ticket propio.
 */
export default fp(async (app: FastifyInstance, opts: PickupExpirySweepPluginOptions = {}) => {
  const repository = createShipmentRepository(app.db);
  const usersClient = opts.usersClient ?? createUsersClient(app.config);
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  // MOVO-258 (D6): con `offerRepository` el barrido deja vivo un envío mientras tenga
  // ofertas vigentes y avisa al emisor (una vez, dedupe en Redis) el día de retiro.
  const service = createShipmentsService(repository, usersClient, notificationsClient, app.log, {
    offerRepository: createOfferRepository(app.db),
    claimNotificationOnce: async (key, ttlSeconds) =>
      (await app.redis.set(`notified:${key}`, "1", "EX", ttlSeconds, "NX")) === "OK",
    releaseNotificationClaim: async (key) => {
      await app.redis.del(`notified:${key}`);
    },
  });

  registerSweep(app, {
    name: "Pickup expiry sweep plugin",
    lockKey: "locks:pickup-expiry-sweep",
    enabled: opts.enabled ?? app.config.PICKUP_EXPIRY_SWEEP_ENABLED ?? true,
    intervalMinutes: app.config.PICKUP_EXPIRY_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante la ejecución del sweep de retiro vencido",
    run: async () => {
      await service.expireOverduePublishedShipments();
    },
  });
});
