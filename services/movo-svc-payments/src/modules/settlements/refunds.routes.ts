import { FastifyInstance } from "fastify";
import { ApiError, type CreateRefundRequest } from "@movo/shared";
import { createRefundSchema, listRefundsSchema } from "./refunds.schema";

/** Campos que acepta el body del reembolso. */
const REFUND_BODY_KEYS = new Set(["amountArs", "reason", "idempotencyKey", "adminId"]);

/**
 * MOVO-336: endpoints INTERNOS del reembolso de un pago capturado, los consume quien resuelve una disputa
 * (MOVO-337). Mismo criterio que la captura (MOVO-212): sin ruta en el gateway ni hook de `x-user-id`, solo
 * alcanzables desde la red interna (ADR-010). Cuelgan de `/internal/payments/settlements`.
 */
export default async function refundsRoutes(app: FastifyInstance) {
  app.post(
    "/by-shipment/:shipmentId/refund",
    {
      schema: createRefundSchema,
      // Ajv de Fastify borra en silencio las claves de más (`removeAdditional`): un `{ amount: 300 }` mal escrito
      // llegaría como un body sin monto y reembolsaría el TOTAL. Acá se rechaza con 400 antes de validar (mismo
      // problema que la captura, review de PR #261).
      preValidation: async (request) => {
        const body = request.body;
        const unknown =
          typeof body === "object" && body !== null && !Array.isArray(body)
            ? Object.keys(body).filter((key) => !REFUND_BODY_KEYS.has(key))
            : [];
        if (unknown.length > 0) {
          throw new ApiError(400, "VALIDATION_FAILED", `Campos desconocidos en el reembolso: ${unknown.join(", ")}`);
        }
      },
    },
    async (request) => {
      const { shipmentId } = request.params as { shipmentId: string };
      return app.refunds.refund(shipmentId, request.body as CreateRefundRequest);
    }
  );

  app.get("/by-shipment/:shipmentId/refunds", { schema: listRefundsSchema }, async (request) => {
    const { shipmentId } = request.params as { shipmentId: string };
    return app.refunds.list(shipmentId);
  });
}
