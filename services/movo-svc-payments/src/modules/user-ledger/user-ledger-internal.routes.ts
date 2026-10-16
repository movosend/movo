import { FastifyInstance } from "fastify";
import type { CreateManualAdjustmentRequest, CreateUserLedgerEntryRequest } from "@movo/shared";
import { createEntryInternalSchema, getBalanceInternalSchema, manualAdjustmentInternalSchema } from "./user-ledger.schema";

/**
 * MOVO-309 (ADR-044): cuenta corriente, endpoints INTERNOS que llama `svc-shipments` (penalidades,
 * comisión en efectivo) y `svc-admin` (ajuste manual). Sin ruta en el gateway ni hook de
 * `x-user-id`: el caller es un servicio (ADR-010). Cuelgan de `/internal/payments/users`, el mismo
 * prefijo que la baja de tarjetas.
 */
export default async function userLedgerInternalRoutes(app: FastifyInstance) {
  app.get("/:userId/balance", { schema: getBalanceInternalSchema }, async (request) => {
    const { userId } = request.params as { userId: string };
    return app.userLedger.balance(userId);
  });

  // 201 si crea el movimiento, 200 si la idempotencyKey ya existía (devuelve el original).
  app.post("/:userId/ledger-entries", { schema: createEntryInternalSchema }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const result = await app.userLedger.createEntry(userId, request.body as CreateUserLedgerEntryRequest);
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.post("/:userId/manual-adjustments", { schema: manualAdjustmentInternalSchema }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const result = await app.userLedger.createManualAdjustment(userId, request.body as CreateManualAdjustmentRequest);
    return reply.code(result.created ? 201 : 200).send(result);
  });
}
