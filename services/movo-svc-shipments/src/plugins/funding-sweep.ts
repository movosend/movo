import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";
import { createPaymentsClient, PaymentsClient } from "../adapters/payments-client";
import { UsersClient } from "../adapters/users-client";
import { NotificationsClient } from "../adapters/notifications-client";
import { buildFundingService } from "../modules/funding/funding.routes";

export interface FundingSweepPluginOptions {
  usersClient?: UsersClient;
  notificationsClient?: NotificationsClient;
  paymentsClient?: PaymentsClient;
  enabled?: boolean;
}

/**
 * MOVO-210 (AC5/AC7/AC9/AC10): barrido de la saga de asignación. Cada vuelta, en orden:
 * (1) revierte a `published` los `assignment_pending` cuyo plazo de pago venció,
 * (2) procesa los `assigned_unfunded`: aviso al abrirse la ventana, recordatorios y vuelta
 * a `published` a T-24h sin pago. Mismo esqueleto (`setInterval` + lock Redis) que el resto
 * de los barridos; idempotente y tolerante a reejecución: cada paso mira el estado actual
 * del envío y los avisos se deduplican con `SET NX` en Redis.
 */
export default fp(async (app: FastifyInstance, opts: FundingSweepPluginOptions = {}) => {
  const service = buildFundingService(app, {
    ...opts,
    paymentsClient: opts.paymentsClient ?? createPaymentsClient(app.config),
    claimNotificationOnce: async (key, ttlSeconds) =>
      (await app.redis.set(`notified:${key}`, "1", "EX", ttlSeconds, "NX")) === "OK",
    releaseNotificationClaim: async (key) => {
      await app.redis.del(`notified:${key}`);
    },
  });

  registerSweep(app, {
    name: "Funding sweep plugin",
    lockKey: "locks:funding-sweep",
    enabled: opts.enabled ?? app.config.FUNDING_SWEEP_ENABLED ?? true,
    intervalMinutes: app.config.FUNDING_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante el sweep de la saga de asignación",
    run: async () => {
      await service.expireUnpaidAssignmentPending();
      await service.processUnfundedAssignments();
    },
  });
});
