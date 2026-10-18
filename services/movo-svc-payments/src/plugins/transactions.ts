import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createTransactionRepository } from "../repositories/transaction-repository";
import { createTransactionsService, TransactionsService } from "../modules/transactions/transactions.service";

/** MOVO-303: arma el service del historial de transacciones. Va después de env y DB. */
export default fp(async (app: FastifyInstance) => {
  app.decorate("transactions", createTransactionsService({ transactions: createTransactionRepository(app.db) }));
});

declare module "fastify" {
  interface FastifyInstance {
    transactions: TransactionsService;
  }
}
