import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { CashPaymentsService, createCashPaymentsService } from "../modules/cash-payments/cash-payments.service";

/** MOVO-37: arma el service de envíos en efectivo. Va después de la DB. */
export default fp(async (app: FastifyInstance) => {
  app.decorate("cashPayments", createCashPaymentsService(app.db));
});

declare module "fastify" {
  interface FastifyInstance {
    cashPayments: CashPaymentsService;
  }
}
