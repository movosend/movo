import { FastifyInstance, FastifyRequest } from "fastify";
import type { TransactionRole } from "@movo/shared";
import { getTransactionSchema, listTransactionsSchema } from "./transactions.schema";

/** El hook de `paymentsRoutes` ya validó que `x-user-id` existe y es un UUID. */
function userIdOf(request: FastifyRequest): string {
  const raw = request.headers["x-user-id"];
  return (Array.isArray(raw) ? raw[0] : raw) as string;
}

/**
 * MOVO-303: historial de transacciones del usuario autenticado. Se registra dentro de
 * `paymentsRoutes` para heredar su hook de `x-user-id`; todo se filtra por ese usuario y por
 * el rol pedido, así una transacción ajena responde el mismo 404 que una inexistente.
 */
export default async function transactionsRoutes(app: FastifyInstance) {
  const service = app.transactions;

  app.get("/", { schema: listTransactionsSchema }, async (request) => {
    const query = request.query as {
      role: TransactionRole;
      status?: string[];
      from?: string;
      to?: string;
      cursor?: string;
      limit?: number;
    };
    return service.list(userIdOf(request), query);
  });

  app.get("/:id", { schema: getTransactionSchema }, async (request) => {
    const { id } = request.params as { id: string };
    const { role } = request.query as { role: TransactionRole };
    return service.get(userIdOf(request), role, id);
  });
}
