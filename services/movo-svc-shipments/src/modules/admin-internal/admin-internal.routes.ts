import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { ApiError, ChatReportParties, ShipmentParties } from "@movo/shared";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createChatRepository } from "../../repositories/chat-repository";
import { adminInternalSchemas } from "./admin-internal.schema";

/**
 * Módulo interno (MOVO-288): las partes de un envío o de un reporte de chat, para la regla de
 * conflicto de interés de `svc-admin` (un admin no puede actuar sobre algo en lo que es parte).
 * No pasa por el gateway, solo es alcanzable dentro de la red Docker interna (ADR-010), mismo
 * patrón que `mutual-connections`. De solo lectura y sin `x-user-id`: quien decide es `svc-admin`.
 */
export default async function adminInternalRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const shipmentRepository = createShipmentRepository(app.db);
  const chatRepository = createChatRepository(app.db);

  app.get(
    "/shipments/:id/parties",
    {
      schema: {
        hide: true,
        params: adminInternalSchemas.idParam,
        response: { 200: adminInternalSchemas.shipmentPartiesResponse },
      },
    },
    async (request: FastifyRequest): Promise<ShipmentParties> => {
      const { id } = request.params as { id: string };
      const parties = await shipmentRepository.findParties(id);
      if (!parties) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      return parties;
    },
  );

  // Quien reportó y todas las partes del envío: moderar un reporte de chat toca a todos ellos.
  app.get(
    "/chat-reports/:id/parties",
    {
      schema: {
        hide: true,
        params: adminInternalSchemas.idParam,
        response: { 200: adminInternalSchemas.chatReportPartiesResponse },
      },
    },
    async (request: FastifyRequest): Promise<ChatReportParties> => {
      const { id } = request.params as { id: string };
      const report = await chatRepository.findReportById(id);
      const parties = report ? await shipmentRepository.findParties(report.shipmentId) : null;
      if (!report || !parties) throw new ApiError(404, "NOT_FOUND", "Reporte no encontrado.");

      const partyIds = new Set<string>([report.reporterId, parties.senderId, ...parties.formerReceiverIds]);
      if (parties.carrierId) partyIds.add(parties.carrierId);
      if (parties.receiverId) partyIds.add(parties.receiverId);

      return { reportId: report.id, shipmentId: report.shipmentId, reporterId: report.reporterId, partyIds: [...partyIds] };
    },
  );
}
