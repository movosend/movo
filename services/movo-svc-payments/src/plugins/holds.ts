import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createCarrierMpAccountRepository } from "../repositories/carrier-mp-account-repository";
import { createHoldRepository } from "../repositories/hold-repository";
import { createTokenCipher } from "../utils/token-cipher";
import { createHoldService, HoldService } from "../modules/holds/hold.service";

/**
 * MOVO-209: arma el service de holds con el cliente de MP ya decorado en `app`. Va
 * después de env, DB y de `app.decorate("mercadoPago", ...)`.
 */
export default fp(async (app: FastifyInstance) => {
  app.decorate(
    "holds",
    createHoldService({
      holdValidityDays: app.config.MP_HOLD_VALIDITY_DAYS,
      holds: createHoldRepository(app.db),
      accounts: createCarrierMpAccountRepository(app.db, createTokenCipher(app.config.MP_TOKEN_ENCRYPTION_KEY)),
      mercadoPago: app.mercadoPago,
      log: app.log,
    })
  );
});

declare module "fastify" {
  interface FastifyInstance {
    holds: HoldService;
  }
}
