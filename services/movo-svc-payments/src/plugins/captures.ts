import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createCarrierMpAccountRepository } from "../repositories/carrier-mp-account-repository";
import { createHoldRepository } from "../repositories/hold-repository";
import { createSettlementRepository } from "../repositories/settlement-repository";
import { createUserLedgerRepository } from "../repositories/user-ledger-repository";
import { createTokenCipher } from "../utils/token-cipher";
import { CaptureService, createCaptureService } from "../modules/settlements/capture.service";

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
    })
  );
});

declare module "fastify" {
  interface FastifyInstance {
    captures: CaptureService;
  }
}
