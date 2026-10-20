import { FastifyInstance } from "fastify";

const carrierAccountStatusSchema = {
  hide: true,
  params: {
    type: "object",
    required: ["userId"],
    properties: { userId: { type: "string", format: "uuid" } },
  },
  response: {
    200: {
      type: "object",
      required: ["linked"],
      properties: { linked: { type: "boolean" } },
    },
  },
} as const;

const adminSummarySchema = {
  hide: true,
  params: carrierAccountStatusSchema.params,
  response: {
    200: {
      type: "object",
      required: ["status", "nickname", "connectedAt", "unlinkedAt"],
      properties: {
        status: { type: "string", enum: ["linked", "not_linked", "revoked"] },
        nickname: { type: ["string", "null"] },
        connectedAt: { type: ["string", "null"] },
        unlinkedAt: { type: ["string", "null"] },
      },
    },
  },
} as const;

/**
 * MOVO-116 (ADR-036): consultado por `movo-svc-shipments` para bloquear declarar viaje,
 * ofertar, editar oferta e iniciar viaje sin una cuenta de MP con la que se pueda cobrar.
 * Interno, mismo criterio que `/internal/payments/holds` (MOVO-209): sin ruta en el
 * gateway (ADR-010) y sin el hook de `x-user-id`, porque el usuario va en el path.
 */
export default async function mpConnectInternalRoutes(app: FastifyInstance) {
  const service = app.mpConnect;

  app.get("/:userId/status", { schema: carrierAccountStatusSchema }, async (request) => {
    const { userId } = request.params as { userId: string };
    return service.getCarrierAccountStatus(userId);
  });

  // MOVO-294: el `{ linked }` de arriba no alcanza para la ficha del panel (alias, fechas, revocada).
  app.get("/:userId/admin-summary", { schema: adminSummarySchema }, async (request) => {
    const { userId } = request.params as { userId: string };
    return service.getAdminSummary(userId);
  });
}
