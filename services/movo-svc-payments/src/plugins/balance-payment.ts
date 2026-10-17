import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createBalancePaymentAttemptRepository } from "../repositories/balance-payment-attempt-repository";
import { createSavedCardRepository } from "../repositories/saved-card-repository";
import { readBalanceNetOfReservations } from "../repositories/user-ledger-repository";
import type { EnvConfig } from "../config/env";
import {
  BalanceCollector,
  BalancePaymentService,
  createBalancePaymentService,
} from "../modules/balance-payment/balance-payment.service";

/**
 * MOVO-312: arma el service de "Pagar mi saldo". Va DESPUÉS de `mpWebhooks` (usa `app.alerts`), de `userLedger` y de
 * `mercadoPago`; el webhook lo consulta recién al procesar una notificación, así que no hay dependencia circular.
 */
/** Las tres `MP_COLLECTOR_*` o ninguna: Compose inyecta vacías las que no están cargadas. */
function collectorFromConfig(config: EnvConfig): BalanceCollector | undefined {
  const { MP_COLLECTOR_ACCESS_TOKEN: accessToken, MP_COLLECTOR_PUBLIC_KEY: publicKey, MP_COLLECTOR_MP_USER_ID: mpUserId } = config;
  return accessToken && publicKey && mpUserId ? { accessToken, publicKey, mpUserId } : undefined;
}

export default fp(async (app: FastifyInstance) => {
  app.decorate(
    "balancePayment",
    createBalancePaymentService({
      attempts: createBalancePaymentAttemptRepository(app.db),
      ledger: app.userLedger,
      payableBalance: async (userId) => (await readBalanceNetOfReservations(app.db, userId)).toNumber(),
      mercadoPago: app.mercadoPago,
      savedCards: createSavedCardRepository(app.db),
      collector: collectorFromConfig(app.config),
      alerts: app.alerts,
      log: app.log,
    })
  );
});

declare module "fastify" {
  interface FastifyInstance {
    balancePayment: BalancePaymentService;
  }
}
