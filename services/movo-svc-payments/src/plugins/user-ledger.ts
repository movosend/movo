import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createUserLedgerRepository } from "../repositories/user-ledger-repository";
import { createUserLedgerService, UserLedgerService } from "../modules/user-ledger/user-ledger.service";

/** MOVO-309: arma el service de la cuenta corriente del usuario. Va después de env y DB. */
export default fp(async (app: FastifyInstance) => {
  app.decorate("userLedger", createUserLedgerService({
    ledger: createUserLedgerRepository(app.db), db: app.db,
    shipmentsClient: app.shipmentsClient,
    maxManualAdjustmentArs: app.config.ADMIN_LEDGER_ADJUSTMENT_MAX_ARS,
  }));
});

declare module "fastify" {
  interface FastifyInstance {
    userLedger: UserLedgerService;
  }
}
