import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { MercadoPagoOAuthClient } from "../adapters/mercadopago-oauth-client";
import { createCarrierMpAccountRepository } from "../repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../utils/token-cipher";
import { createMpConnectStateStore } from "../modules/mp-connect/mp-connect-state-store";
import { createMpConnectService, MpConnectService } from "../modules/mp-connect/mp-connect.service";

export interface MpConnectPluginOptions {
  oauthClient: MercadoPagoOAuthClient;
}

/**
 * MOVO-111: arma el service de la vinculación una sola vez y lo comparte entre las
 * rutas protegidas (`/payments/mp-connect/*`) y el callback público, que viven en
 * plugins distintos. Va después de env, DB y Redis.
 */
export default fp<MpConnectPluginOptions>(async (app: FastifyInstance, opts) => {
  app.decorate(
    "mpConnect",
    createMpConnectService({
      config: app.config,
      repository: createCarrierMpAccountRepository(app.db, createTokenCipher(app.config.MP_TOKEN_ENCRYPTION_KEY)),
      stateStore: createMpConnectStateStore(app.redis),
      oauthClient: opts.oauthClient,
      log: app.log,
    })
  );
});

declare module "fastify" {
  interface FastifyInstance {
    mpConnect: MpConnectService;
  }
}
