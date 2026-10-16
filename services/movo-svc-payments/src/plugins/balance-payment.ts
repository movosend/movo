import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createBalancePaymentAttemptRepository } from "../repositories/balance-payment-attempt-repository";
import { createCarrierMpAccountRepository } from "../repositories/carrier-mp-account-repository";
import { createSavedCardRepository } from "../repositories/saved-card-repository";
import { createTokenCipher } from "../utils/token-cipher";
import { BalancePaymentService, createBalancePaymentService } from "../modules/balance-payment/balance-payment.service";

/**
 * MOVO-312: arma el service de "Pagar mi saldo". Va DESPUÉS de `mpWebhooks` (usa `app.alerts`), de `userLedger` y de
 * `mercadoPago`; el webhook lo consulta recién al procesar una notificación, así que no hay dependencia circular.
 */
export default fp(async (app: FastifyInstance) => {
  app.decorate(
    "balancePayment",
    createBalancePaymentService({
      attempts: createBalancePaymentAttemptRepository(app.db),
      ledger: app.userLedger,
      mercadoPago: app.mercadoPago,
      accounts: createCarrierMpAccountRepository(app.db, createTokenCipher(app.config.MP_TOKEN_ENCRYPTION_KEY)),
      savedCards: createSavedCardRepository(app.db),
      collectorUserId: app.config.MOVO_COLLECTOR_USER_ID || undefined,
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
