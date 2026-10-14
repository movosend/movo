import { FastifyInstance } from "fastify";
import { deleteUserCardsInternalSchema } from "./cards.schema";

/**
 * MOVO-100 AC8: endpoint INTERNO para la baja de cuenta (MOVO-39). Sin ruta en el gateway
 * ni hook de `x-user-id` (el caller es `svc-users`, ADR-010). Best-effort: borra el
 * customer y las tarjetas en MP y las filas locales; si MP falla se registra y se responde
 * igual, para no trabar la baja (mismo criterio que la traza GPS, ADR-023).
 */
export default async function cardsInternalRoutes(app: FastifyInstance) {
  app.delete("/:userId/cards", { schema: deleteUserCardsInternalSchema }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    await app.cards.removeAllForUser(userId);
    return reply.code(204).send();
  });
}
