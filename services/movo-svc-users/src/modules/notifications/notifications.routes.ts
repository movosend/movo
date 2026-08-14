import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { createNotificationsService } from "./notifications.service";
import { notificationsSchemas } from "./notifications.schema";
import { createPushNotificationProvider, PushNotificationProvider } from "../../adapters/push-notification-provider";

export interface NotificationsRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración — evita depender de red (MOVO-106),
   * mismo criterio que `storageProvider`/`geocodingProvider`. */
  pushProvider?: PushNotificationProvider;
}

/**
 * Módulo interno (AC6): no pasa por el gateway (no se declara `/internal` en
 * `gateway/src/config/routes-map.ts`), así que solo es alcanzable dentro de la red
 * Docker interna por otros servicios (mismo modelo de confianza perimetral de
 * ADR-010). Por eso el `userId` viaja en el body en vez de derivarse de un header
 * `x-user-id` — el caller es otro servicio, no un usuario autenticado.
 */
export default async function notificationsRoutes(app: FastifyInstance, opts: NotificationsRoutesOptions) {
  const pushProvider = opts.pushProvider ?? createPushNotificationProvider(app.config);
  const service = createNotificationsService(app.db, pushProvider, app.log);

  app.post(
    "/push",
    {
      // AC7: no se documenta en la Swagger pública — endpoint interno, no forma parte
      // del contrato que consumen los clientes.
      schema: { hide: true, body: notificationsSchemas.internalPushBody },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId, title, body, data } = request.body as {
        userId: string;
        title: string;
        body: string;
        data?: Record<string, unknown>;
      };
      await service.sendPushToUser(userId, { title, body, ...(data !== undefined ? { data } : {}) });
      reply.code(204);
    },
  );
}
