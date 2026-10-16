import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import {
  AlertNotifier,
  createConsoleAlertNotifier,
  createTelegramAlertNotifier,
} from "../adapters/alert-notifier";
import { createShipmentsClient, ShipmentsClient } from "../adapters/shipments-client";
import { createCarrierMpAccountRepository } from "../repositories/carrier-mp-account-repository";
import { createHoldRepository } from "../repositories/hold-repository";
import { createMpWebhookRepository } from "../repositories/mp-webhook-repository";
import { createTokenCipher } from "../utils/token-cipher";
import { createMpWebhookService, MpWebhookService } from "../modules/webhooks/mp-webhook.service";

export interface MpWebhooksPluginOptions {
  /** Override solo para tests (mismo criterio que `mercadoPagoClient`). */
  shipmentsClient?: ShipmentsClient;
  alertNotifier?: AlertNotifier;
}

function buildAlertNotifier(app: FastifyInstance): AlertNotifier {
  const { ALERT_PROVIDER, ALERT_TELEGRAM_BOT_TOKEN, ALERT_TELEGRAM_CHAT_ID, ALERT_ENVIRONMENT_LABEL } = app.config;
  if (ALERT_PROVIDER === "telegram") {
    if (!ALERT_TELEGRAM_BOT_TOKEN || !ALERT_TELEGRAM_CHAT_ID) {
      throw new Error("ALERT_PROVIDER=telegram necesita ALERT_TELEGRAM_BOT_TOKEN y ALERT_TELEGRAM_CHAT_ID");
    }
    return createTelegramAlertNotifier(
      {
        botToken: ALERT_TELEGRAM_BOT_TOKEN,
        chatId: ALERT_TELEGRAM_CHAT_ID,
        environmentLabel: ALERT_ENVIRONMENT_LABEL || undefined,
      },
      app.log
    );
  }
  return createConsoleAlertNotifier(app.log);
}

/**
 * MOVO-268: arma el procesamiento del webhook de MP y el barrido que reintenta las
 * notificaciones `pending`. Va después de `holds` (reusa su service para reconciliar un
 * intento en `creating`).
 *
 * El barrido es un `setInterval` simple, sin lock de Redis: dos corridas a la vez (o el
 * barrido y el procesamiento inmediato) no se pisan porque cada notificación se toma con
 * un UPDATE condicional (`claim`).
 */
export default fp<MpWebhooksPluginOptions>(async (app, opts) => {
  const alerts = opts.alertNotifier ?? buildAlertNotifier(app);
  app.decorate("alerts", alerts);

  const service = createMpWebhookService({
    repo: createMpWebhookRepository(app.db),
    holds: createHoldRepository(app.db),
    holdService: app.holds,
    accounts: createCarrierMpAccountRepository(app.db, createTokenCipher(app.config.MP_TOKEN_ENCRYPTION_KEY)),
    mercadoPago: app.mercadoPago,
    shipments: opts.shipmentsClient ?? createShipmentsClient(app.config.SHIPMENTS_SERVICE_URL),
    alerts,
    log: app.log,
    holdValidityDays: app.config.MP_HOLD_VALIDITY_DAYS,
    maxAttempts: app.config.MP_WEBHOOK_MAX_ATTEMPTS,
    // MOVO-312: se resuelve al procesar cada notificación; el plugin de "Pagar mi saldo" va después de este.
    balancePayments: () => app.balanceCheckout,
  });
  app.decorate("mpWebhooks", service);

  const { MP_WEBHOOK_SWEEP_ENABLED, MP_WEBHOOK_SWEEP_INTERVAL_MINUTES } = app.config;
  if (MP_WEBHOOK_SWEEP_ENABLED && MP_WEBHOOK_SWEEP_INTERVAL_MINUTES > 0) {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      service
        .processDue()
        .catch((error) => app.log.error({ err: error }, "falló el barrido del webhook de MP"))
        .finally(() => {
          running = false;
        });
    }, MP_WEBHOOK_SWEEP_INTERVAL_MINUTES * 60 * 1000);
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  } else {
    app.log.info("Barrido del webhook de MP desactivado.");
  }

  // Lo que quedó procesándose en segundo plano termina antes de cerrar la DB.
  app.addHook("onClose", async () => service.drain());
});

declare module "fastify" {
  interface FastifyInstance {
    mpWebhooks: MpWebhookService;
    alerts: AlertNotifier;
  }
}
