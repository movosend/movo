import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { NotificationsClient } from "../adapters/notifications-client";
import { createNotificationsClient } from "../adapters/notifications-client";
import { PaymentsClient } from "../adapters/payments-client";
import { createAppPaymentsClient } from "../adapters/simulated-payments-client";
import { createShipmentRepository } from "../repositories/shipment-repository";
import {
  createSettlementService,
  SettlementRetryState,
  SettlementService,
  settlementRetryCooldownSeconds,
} from "../modules/settlements/settlement.service";

declare module "fastify" {
  interface FastifyInstance {
    /** MOVO-212: el service de liquidación, armado UNA vez y compartido por el notifier del handshake, el barrido y las rutas. */
    settlements: SettlementService;
  }
}

export interface SettlementsPluginOptions {
  /** Overrides solo para tests de integración. */
  notificationsClient?: NotificationsClient;
  paymentsClient?: PaymentsClient;
}

const ATTEMPTS_TTL_SECONDS = 14 * 24 * 60 * 60;

/** Enfriamiento por envío del barrido, en Redis (compartido entre réplicas). */
function createRedisRetryState(app: FastifyInstance): SettlementRetryState {
  const cooldownKey = (id: string) => `settlement-sweep:cooldown:${id}`;
  const attemptsKey = (id: string) => `settlement-sweep:attempts:${id}`;
  return {
    async isCoolingDown(shipmentId) {
      return (await app.redis.exists(cooldownKey(shipmentId))) === 1;
    },
    async recordFailure(shipmentId, permanent) {
      const attempts = await app.redis.incr(attemptsKey(shipmentId));
      await app.redis.expire(attemptsKey(shipmentId), ATTEMPTS_TTL_SECONDS);
      await app.redis.set(cooldownKey(shipmentId), "1", "EX", settlementRetryCooldownSeconds(attempts, permanent));
    },
    async clear(shipmentId) {
      await app.redis.del(cooldownKey(shipmentId), attemptsKey(shipmentId));
    },
  };
}

/**
 * MOVO-212 (review de PR #235): el service de liquidación se armaba tres veces (notifier del handshake,
 * barrido y rutas), cada una con su repositorio y sus clientes, y un override de test podía llegar a una
 * instancia y no a las otras. Ahora se arma acá una sola vez y se decora como `app.settlements`.
 * El dedupe de los pushes (Redis `SET NX`) y el enfriamiento del barrido se cablean siempre, así la
 * captura en línea y el barrido comparten las mismas marcas.
 */
export default fp(async (app: FastifyInstance, opts: SettlementsPluginOptions = {}) => {
  app.decorate(
    "settlements",
    createSettlementService({
      repository: createShipmentRepository(app.db),
      paymentsClient: opts.paymentsClient ?? createAppPaymentsClient(app),
      notificationsClient: opts.notificationsClient ?? createNotificationsClient(app.config),
      logger: app.log,
      claimNotificationOnce: async (key, ttlSeconds) =>
        (await app.redis.set(`notified:${key}`, "1", "EX", ttlSeconds, "NX")) === "OK",
      retryState: createRedisRetryState(app),
      reviewHours: app.config.SETTLEMENT_REVIEW_SLA_HOURS,
    })
  );
});
