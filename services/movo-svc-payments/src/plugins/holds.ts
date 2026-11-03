import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createCarrierMpAccountRepository } from "../repositories/carrier-mp-account-repository";
import { createHoldRepository } from "../repositories/hold-repository";
import { createSavedCardRepository } from "../repositories/saved-card-repository";
import { readCollectableBalance } from "../repositories/user-ledger-repository";
import { createTokenCipher } from "../utils/token-cipher";
import { createHoldService, HoldService } from "../modules/holds/hold.service";
import { createProviderOutageAlert } from "../modules/holds/provider-outage-alert";

/**
 * MOVO-209: arma el service de holds con el cliente de MP ya decorado en `app`. Va
 * después de env, DB y de `app.decorate("mercadoPago", ...)`.
 */
export default fp(async (app: FastifyInstance) => {
  // `app.alerts` lo decora `mpWebhooks`, que se registra después: se resuelve al momento de avisar.
  const outageAlert = createProviderOutageAlert({
    redis: app.redis,
    alerts: () => (app.hasDecorator("alerts") ? app.alerts : undefined),
    log: app.log,
  });
  app.decorate(
    "holds",
    createHoldService({
      holdValidityDays: app.config.MP_HOLD_VALIDITY_DAYS,
      debtCollectionMaxRate: app.config.DEBT_COLLECTION_MAX_RATE,
      ledgerBalance: async (userId) => (await readCollectableBalance(app.db, userId)).toNumber(),
      holds: createHoldRepository(app.db),
      accounts: createCarrierMpAccountRepository(app.db, createTokenCipher(app.config.MP_TOKEN_ENCRYPTION_KEY)),
      mercadoPago: app.mercadoPago,
      savedCards: createSavedCardRepository(app.db),
      log: app.log,
      onProviderUnavailable: (failure) => outageAlert.record(failure),
    })
  );
});

declare module "fastify" {
  interface FastifyInstance {
    holds: HoldService;
  }
}
