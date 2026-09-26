import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { mutualConnectionsSchemas } from "./mutual-connections.schema";

/**
 * Módulo interno (MOVO-174): no pasa por el gateway (no se declara `/internal` en
 * `gateway/src/config/routes-map.ts`), así que solo es alcanzable dentro de la red Docker
 * interna -- mismo modelo de confianza perimetral (ADR-010) y mismo patrón que
 * `account-deletion` (MOVO-134). Lo consulta `movo-svc-users` para
 * `GET /users/:id/mutual-connections`.
 *
 * De solo lectura y devuelve únicamente un conteo: ningún id de terceros sale de este
 * servicio (decisión de privacidad, ver `MutualConnections` en `@movo/shared`).
 */
export default async function mutualConnectionsRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const repository = createShipmentRepository(app.db);

  app.get(
    "/users/:userId/mutual-connections/:otherId",
    {
      schema: {
        hide: true,
        params: mutualConnectionsSchemas.usersParam,
        response: { 200: mutualConnectionsSchemas.mutualConnectionsResponse },
      },
    },
    async (request: FastifyRequest) => {
      const { userId, otherId } = request.params as { userId: string; otherId: string };
      return { totalCount: await repository.countMutualCounterparties(userId, otherId) };
    },
  );
}
