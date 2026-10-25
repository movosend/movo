import { FastifyInstance } from "fastify";
import type {
  CreateManualAdjustmentRequest,
  CreateUserLedgerEntryRequest,
  DebtCollectionPreviewRequest,
} from "@movo/shared";
import {
  adminLedgerInternalSchema,
  createEntryInternalSchema,
  debtCollectionPreviewInternalSchema,
  getBalanceInternalSchema,
  manualAdjustmentInternalSchema,
} from "./user-ledger.schema";

/**
 * MOVO-309 (DD-044): cuenta corriente, endpoints INTERNOS que llama `svc-shipments` (penalidades,
 * comisión en efectivo) y `svc-admin` (ajuste manual). Sin ruta en el gateway ni hook de
 * `x-user-id`: el caller es un servicio (ADR-010). Cuelgan de `/internal/payments/users`, el mismo
 * prefijo que la baja de tarjetas.
 */
export default async function userLedgerInternalRoutes(app: FastifyInstance) {
  app.get("/:userId/balance", { schema: getBalanceInternalSchema }, async (request) => {
    const { userId } = request.params as { userId: string };
    return app.userLedger.balance(userId);
  });

  // MOVO-311: cuánto de su deuda se le descontaría al transportista en cada precio. No reserva nada.
  app.post("/:userId/debt-collection/preview", { schema: debtCollectionPreviewInternalSchema }, async (request) => {
    const { userId } = request.params as { userId: string };
    return app.holds.previewCarrierDebt(userId, (request.body as DebtCollectionPreviewRequest).amountsArs);
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

  // MOVO-294: la cuenta corriente en la ficha del panel, con el motivo y el admin de cada ajuste.
  app.get("/:userId/admin-ledger", { schema: adminLedgerInternalSchema }, async (request) => {
    const { userId } = request.params as { userId: string };
    return app.userLedger.adminPage(userId, request.query as { cursor?: string; limit?: number });
  });
}
