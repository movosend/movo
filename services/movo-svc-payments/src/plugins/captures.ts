import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createCarrierMpAccountRepository } from "../repositories/carrier-mp-account-repository";
import { createHoldRepository } from "../repositories/hold-repository";
import { createSettlementRepository } from "../repositories/settlement-repository";
import { createUserLedgerRepository } from "../repositories/user-ledger-repository";
import { createTokenCipher } from "../utils/token-cipher";
import { CaptureService, createCaptureService } from "../modules/settlements/capture.service";
import { parseRetryDelays } from "../modules/settlements/capture-failure";
import { createSettlementEscalationNotifier } from "../modules/settlements/settlement-escalation";

/** MOVO-212: arma el service de captura con el cliente de MP ya decorado en `app`. */
export default fp(async (app: FastifyInstance) => {
  app.decorate(
    "captures",
    createCaptureService({
      holds: createHoldRepository(app.db),
      settlements: createSettlementRepository(app.db),
      accounts: createCarrierMpAccountRepository(app.db, createTokenCipher(app.config.MP_TOKEN_ENCRYPTION_KEY)),
      mercadoPago: app.mercadoPago,
      ledger: createUserLedgerRepository(app.db),
      log: app.log,
      // MOVO-213: esperas entre reintentos de una captura fallida (su largo es el máximo de reintentos).
      retryDelaysMinutes: parseRetryDelays(app.config.SETTLEMENT_RETRY_DELAYS_MINUTES),
      // `app.alerts` lo decora `mpWebhooksPlugin`, que se registra después: se resuelve recién al escalar.
      onEscalated: createSettlementEscalationNotifier({ alerts: () => app.alerts, shipments: app.shipmentsClient, log: app.log }),
    })
  );
});

declare module "fastify" {
  interface FastifyInstance {
    captures: CaptureService;
  }
}
