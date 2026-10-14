import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { settlementSchemas } from "./settlements.schema";

export type SettlementRoutesOptions = FastifyPluginOptions;

/**
 * MOVO-212 (AC10): `GET /shipments/:id/settlement`, el pago del envío con visibilidad por
 * rol. Alimenta el detalle del pago en la app (MOVO-214).
 */
export default async function settlementRoutes(app: FastifyInstance, _opts: SettlementRoutesOptions) {
  const service = app.settlements;

  app.get(
    "/:id/settlement",
    {
      schema: {
        summary: "Pago del envío, según el rol de quien consulta",
        description:
          "MOVO-212 AC10: el transportista ve bruto, fee de Mercado Pago, comisión de Movo y neto; el " +
          "emisor solo el total pagado y la fecha; el receptor no accede (403). `status` es " +
          "`processing` (todavía se está cobrando), `credited` o `escalated`.",
        tags: ["settlements"],
        params: settlementSchemas.shipmentIdParam,
        response: {
          200: settlementSchemas.settlementResponse,
          401: settlementSchemas.errorResponse,
          403: settlementSchemas.errorResponse,
          404: settlementSchemas.errorResponse,
          502: settlementSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      return service.getForUser(id, callerId);
    }
  );
}
