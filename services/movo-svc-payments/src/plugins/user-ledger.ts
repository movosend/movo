import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createUserLedgerRepository } from "../repositories/user-ledger-repository";
import { createUserLedgerService, UserLedgerService } from "../modules/user-ledger/user-ledger.service";
import { createShipmentsClient, type ShipmentsClient } from "../adapters/shipments-client";

/** MOVO-309: arma el service de la cuenta corriente del usuario. Va después de env y DB. */
export default fp(async (app: FastifyInstance, opts: { shipmentsClient?: ShipmentsClient }) => {
  app.decorate("userLedger", createUserLedgerService({
    ledger: createUserLedgerRepository(app.db), db: app.db,
    shipmentsClient: opts.shipmentsClient ?? createShipmentsClient(app.config.SHIPMENTS_SERVICE_URL),
  }));
});

declare module "fastify" {
  interface FastifyInstance {
    userLedger: UserLedgerService;
  }
}
