import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createPositionRepository } from "../../repositories/position-repository";
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
  const positionRepository = createPositionRepository(app.db);

  app.get(
    "/users/:userId/active-shipments",
    {
      // No se documenta en la Swagger pública -- endpoint interno, no forma parte
      // del contrato que consumen los clientes (mismo criterio que POST /internal/
      // notifications/push en movo-svc-users).
      schema: {
        hide: true,
        params: accountDeletionSchemas.userIdParam,
        response: { 200: accountDeletionSchemas.activeShipmentsResponse },
      },
    },
    async (request: FastifyRequest) => {
      const { userId } = request.params as { userId: string };
      return repository.hasActiveShipmentsForUser(userId);
    },
  );

  /**
   * MOVO-202/AC7: la supresión de cuenta (MOVO-39) alcanza también la traza GPS del
   * usuario como transportista -- borrado inmediato, sin importar la retención
   * normal de `CARRIER_POSITION_RETENTION_DAYS` (esa es para el ciclo de vida
   * regular de un envío, esto es supresión de datos personales a pedido). Llamado
   * por `svc-users#deleteAccount` DESPUÉS de que ya validó que no hay envíos/
   * disputas activos (mismo orden que `active-shipments` de arriba) -- un usuario
   * con un envío `in_transit` nunca llega hasta acá, así que nunca se borra la
   * traza de algo que todavía se está generando.
   */
  app.delete(
    "/users/:userId/carrier-positions",
    {
      schema: {
        hide: true,
        params: accountDeletionSchemas.userIdParam,
        response: { 200: accountDeletionSchemas.deletedPositionsResponse },
      },
    },
    async (request: FastifyRequest) => {
      const { userId } = request.params as { userId: string };
      const deletedCount = await positionRepository.deleteAllForCarrier(userId);
      return { deletedCount };
    },
  );
}
