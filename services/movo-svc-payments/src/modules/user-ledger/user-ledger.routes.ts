import { FastifyInstance } from "fastify";
import { getBalanceSchema } from "./user-ledger.schema";

/**
 * MOVO-309: `GET /payments/balance`, la cuenta corriente del usuario autenticado. Se registra
 * dentro de `paymentsRoutes` para heredar su hook de `x-user-id`; solo ve lo suyo.
 */
export default async function userLedgerRoutes(app: FastifyInstance) {
  app.get("/", { schema: getBalanceSchema }, async (request) => {
    const raw = request.headers["x-user-id"];
    const userId = (Array.isArray(raw) ? raw[0] : raw) as string;
    const { cursor, limit } = request.query as { cursor?: string; limit?: number };
    return app.userLedger.page(userId, { cursor, limit });
  });
}
