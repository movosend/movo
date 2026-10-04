import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";
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
  const repository = createShipmentRepository(app.db);
  const usersClient = opts.usersClient ?? createUsersClient(app.config);
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  const service = createShipmentsService(repository, usersClient, notificationsClient, app.log, {
    receiverConfirmationTimeoutHours: app.config.RECEIVER_CONFIRMATION_TIMEOUT_HOURS,
  });

  registerSweep(app, {
    name: "Receiver confirmation sweep plugin",
    lockKey: "locks:receiver-confirmation-sweep",
    enabled: opts.enabled ?? app.config.RECEIVER_CONFIRMATION_SWEEP_ENABLED ?? true,
    intervalMinutes: app.config.RECEIVER_CONFIRMATION_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante la ejecución del sweep de confirmación de receptor",
    run: async () => {
      await service.expireOverdueShipments();
      // MOVO-253: mismo ciclo de vida (la decisión pendiente sobre el receptor), mismo
      // lock e intervalo -- no amerita un plugin ni variables de entorno propias.
      await service.expireRejectedShipments();
    },
  });
});
