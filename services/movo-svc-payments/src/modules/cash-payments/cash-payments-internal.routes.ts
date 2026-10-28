import { FastifyInstance } from "fastify";
import type { RegisterCashCancellationPenaltyRequest, RegisterCashCommissionRequest } from "@movo/shared";
import { registerCashCancellationPenaltySchema, registerCashCommissionSchema } from "./cash-payments.schema";

/**
 * MOVO-37: endpoints INTERNOS de envíos pagados en efectivo, que llama `svc-shipments` (sin ruta en el gateway,
 * ADR-010). 201 si registra, 200 si el envío ya estaba registrado (devuelve lo original).
 */
export default async function cashPaymentsInternalRoutes(app: FastifyInstance) {
  // Al confirmarse la entrega: la comisión de Movo como deuda del transportista.
  app.post("/:shipmentId/commission", { schema: registerCashCommissionSchema }, async (request, reply) => {
    const { shipmentId } = request.params as { shipmentId: string };
    const result = await app.cashPayments.registerCommission(shipmentId, request.body as RegisterCashCommissionRequest);
    return reply.code(result.created ? 201 : 200).send(result);
  });

  // Cancelación tardía del emisor: su penalidad como deuda y la compensación del transportista como crédito.
  app.post("/:shipmentId/cancellation-penalty", { schema: registerCashCancellationPenaltySchema }, async (request, reply) => {
    const { shipmentId } = request.params as { shipmentId: string };
    const result = await app.cashPayments.registerCancellationPenalty(
      shipmentId,
      request.body as RegisterCashCancellationPenaltyRequest
    );
    return reply.code(result.created ? 201 : 200).send(result);
  });
}
