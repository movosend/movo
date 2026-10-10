import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";
import { createShipmentRepository } from "../repositories/shipment-repository";
import { createOfferRepository } from "../repositories/offer-repository";
import { createUsersClient, UsersClient } from "../adapters/users-client";
import { createNotificationsClient, NotificationsClient } from "../adapters/notifications-client";
import { createPaymentsClient, PaymentsClient } from "../adapters/payments-client";
import { createShipmentsService } from "../modules/shipments/shipments.service";

export interface PickupMissedSweepPluginOptions {
  usersClient?: UsersClient;
  notificationsClient?: NotificationsClient;
  /** MOVO-210: libera el hold de un envío asignado que se cancela por retiro no realizado. */
  paymentsClient?: PaymentsClient;
  enabled?: boolean;
}

/**
 * MOVO-258 (D1): barrido periódico que cancela los envíos con transportista asignado
 * (`assignment_pending`/`assigned_unfunded`/`assigned`) cuya ventana de retiro cerró hace
 * más del margen de gracia (`PICKUP_MISSED_GRACE_HOURS`, 24h). Mismo esqueleto `setInterval`
 * + lock distribuido en Redis que `pickup-expiry-sweep.ts`/`receiver-confirmation-sweep.ts`;
 * la regla de negocio vive en `shipments.service.ts#expireUnpickedAssignedShipments`.
 */
export default fp(async (app: FastifyInstance, opts: PickupMissedSweepPluginOptions = {}) => {
  const repository = createShipmentRepository(app.db);
  const usersClient = opts.usersClient ?? createUsersClient(app.config);
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  const service = createShipmentsService(repository, usersClient, notificationsClient, app.log, {
    pickupMissedGraceHours: app.config.PICKUP_MISSED_GRACE_HOURS,
    paymentsClient: opts.paymentsClient ?? createPaymentsClient(app.config),
    // MOVO-210: avisar a los transportistas con ofertas `pending` de una asignación que esperaba el pago.
    offerRepository: createOfferRepository(app.db),
  });

  registerSweep(app, {
    name: "Pickup missed sweep plugin",
    lockKey: "locks:pickup-missed-sweep",
    enabled: opts.enabled ?? app.config.PICKUP_MISSED_SWEEP_ENABLED ?? true,
    intervalMinutes: app.config.PICKUP_MISSED_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante el sweep de retiro no realizado",
    run: async () => {
      await service.expireUnpickedAssignedShipments();
    },
  });
});
