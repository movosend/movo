import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { accountDeletionSchemas } from "./account-deletion.schema";

/**
 * Módulo interno (MOVO-134): no pasa por el gateway (no se declara `/internal` en
 * `gateway/src/config/routes-map.ts`), así que solo es alcanzable dentro de la red
 * Docker interna por otros servicios (mismo modelo de confianza perimetral de
 * ADR-010, mismo patrón que `/internal/notifications` de `movo-svc-users`, MOVO-106).
 * Primera llamada síncrona en sentido `svc-users` → `svc-shipments` (hasta ahora todas
 * las llamadas internas del proyecto iban al revés, `svc-shipments` → `svc-users`,
 * `users-client.ts` de MOVO-80).
 *
 * De solo lectura -- no cancela ni modifica ningún envío. La baja de cuenta bloquea
 * si el usuario tiene algo activo; es el usuario quien cancela manualmente antes de
 * poder reintentarla (decisión de refinamiento, ver CLAUDE.md).
 */
export default async function accountDeletionRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const repository = createShipmentRepository(app.db);

  app.get(
    "/users/:userId/active-shipments",
    {
      // No se documenta en la Swagger pública -- endpoint interno, no forma parte
      // del contrato que consumen los clientes (mismo criterio que POST /internal/
      // notifications/push en movo-svc-users).
      schema: { hide: true, params: accountDeletionSchemas.userIdParam },
    },
    async (request: FastifyRequest) => {
      const { userId } = request.params as { userId: string };
      return repository.hasActiveShipmentsForUser(userId);
    },
  );
}
