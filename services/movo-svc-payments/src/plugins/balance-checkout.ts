import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { MovoTokenProvider } from "../adapters/mercadopago-customers-client";
import { createBalancePaymentAttemptRepository } from "../repositories/balance-payment-attempt-repository";
import {
  BalanceCheckoutService,
  BalanceTokenProvider,
  createBalanceCheckoutService,
} from "../modules/balance-checkout/balance-checkout.service";

export interface BalanceCheckoutPluginOptions {
  /** Override solo para tests (evita pegarle al sandbox de MP). */
  tokenProvider?: BalanceTokenProvider;
}

/**
 * MOVO-312: arma el service de "Pagar mi saldo". Va DESPUÉS de `mpWebhooks` (usa `app.alerts`), de `userLedger` y de
 * `mercadoPago`; el webhook lo consulta recién al procesar una notificación, así que no hay dependencia circular.
 */
export default fp<BalanceCheckoutPluginOptions>(async (app: FastifyInstance, opts) => {
  const { config } = app;
  // Misma key de Redis que las tarjetas guardadas: se comparte el token de Movo.
  const tokens =
    opts.tokenProvider ??
    new MovoTokenProvider(app.redis, {
      clientId: config.MP_CLIENT_ID,
      clientSecret: config.MP_CLIENT_SECRET,
      testMode: config.MP_TEST_MODE,
    });
  app.decorate(
    "balanceCheckout",
    createBalanceCheckoutService({
      attempts: createBalancePaymentAttemptRepository(app.db),
      ledger: app.userLedger,
      mercadoPago: app.mercadoPago,
      movoToken: tokens,
      alerts: app.alerts,
      log: app.log,
      redirectUri: config.MP_REDIRECT_URI || undefined,
      testMode: config.MP_TEST_MODE,
    })
  );
});

declare module "fastify" {
  interface FastifyInstance {
    balanceCheckout: BalanceCheckoutService;
  }
}
