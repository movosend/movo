import { FastifyInstance } from "fastify";
import { debtCollectionPreviewSchema, getBalanceSchema } from "./user-ledger.schema";
import type { DebtCollectionPreviewRequest } from "@movo/shared";

/**
 * MOVO-309: `GET /payments/balance`, la cuenta corriente del usuario autenticado. Se registra
 * dentro de `paymentsRoutes` para heredar su hook de `x-user-id`; solo ve lo suyo.
 */
export default async function userLedgerRoutes(app: FastifyInstance) {
  app.post("/debt-preview", {
    schema: debtCollectionPreviewSchema,
  }, async (request) => {
    const raw = request.headers["x-user-id"];
    const userId = (Array.isArray(raw) ? raw[0] : raw) as string;
    return app.holds.previewCarrierDebt(userId, (request.body as DebtCollectionPreviewRequest).amountsArs);
  });
  app.get("/", { schema: getBalanceSchema }, async (request) => {
    const raw = request.headers["x-user-id"];
    const userId = (Array.isArray(raw) ? raw[0] : raw) as string;
    const { cursor, limit } = request.query as { cursor?: string; limit?: number };
    return app.userLedger.pageWithOrigins(userId, { cursor, limit });
  });
}
