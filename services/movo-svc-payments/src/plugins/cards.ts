import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import {
  FetchMercadoPagoCustomersClient,
  MercadoPagoCustomersClient,
  MovoTokenProvider,
} from "../adapters/mercadopago-customers-client";
import { createUsersClient, UsersClient } from "../adapters/users-client";
import { createSavedCardRepository } from "../repositories/saved-card-repository";
import { CardsService, createCardsService } from "../modules/cards/cards.service";

export interface CardsPluginOptions {
  /** Override solo para tests (evita pegarle al sandbox de MP). */
  customersClient?: MercadoPagoCustomersClient;
  /** Override solo para tests (evita depender de `svc-users`). */
  usersClient?: UsersClient;
}

/** MOVO-100: arma el service de tarjetas guardadas. Va después de env, DB y Redis. */
export default fp(async (app: FastifyInstance, opts: CardsPluginOptions) => {
  const { config } = app;
  const customersClient =
    opts.customersClient ??
    new FetchMercadoPagoCustomersClient(
      new MovoTokenProvider(app.redis, {
        clientId: config.MP_CLIENT_ID,
        clientSecret: config.MP_CLIENT_SECRET,
        testMode: config.MP_TEST_MODE,
      })
    );

  app.decorate(
    "cards",
    createCardsService({
      cards: createSavedCardRepository(app.db),
      mercadoPago: customersClient,
      users: opts.usersClient ?? createUsersClient({ USERS_SERVICE_URL: config.USERS_SERVICE_URL }),
      log: app.log,
      publicKey: config.MP_PUBLIC_KEY || undefined,
      testMode: config.MP_TEST_MODE,
      testPayerEmailsRaw: config.MP_TEST_PAYER_EMAILS || undefined,
    })
  );
});

declare module "fastify" {
  interface FastifyInstance {
    cards: CardsService;
  }
}
