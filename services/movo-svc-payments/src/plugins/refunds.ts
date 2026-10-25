import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createCarrierMpAccountRepository } from "../repositories/carrier-mp-account-repository";
import { createRefundRepository } from "../repositories/refund-repository";
import { createSettlementRepository } from "../repositories/settlement-repository";
import { createUserLedgerRepository } from "../repositories/user-ledger-repository";
import { createTokenCipher } from "../utils/token-cipher";
import { createRefundService, RefundService } from "../modules/settlements/refund.service";

/** MOVO-336: arma el service de reembolsos con el cliente de MP ya decorado en `app`. */
export default fp(async (app: FastifyInstance) => {
  app.decorate(
    "refunds",
    createRefundService({
      refunds: createRefundRepository(app.db),
      settlements: createSettlementRepository(app.db),
      accounts: createCarrierMpAccountRepository(app.db, createTokenCipher(app.config.MP_TOKEN_ENCRYPTION_KEY)),
      mercadoPago: app.mercadoPago,
      ledger: createUserLedgerRepository(app.db),
      // `app.alerts` lo decora `mpWebhooksPlugin`, que se registra después: se resuelve recién al alertar.
      alerts: () => app.alerts,
      log: app.log,
    })
  );
});

declare module "fastify" {
  interface FastifyInstance {
    refunds: RefundService;
  }
}
