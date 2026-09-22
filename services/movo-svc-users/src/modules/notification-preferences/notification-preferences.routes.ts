import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { createNotificationPreferencesService, UpdateNotificationPreferencesInput } from "./notification-preferences.service";
import { notificationPreferencesSchemas } from "./notification-preferences.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";

/**
 * MOVO-245: `GET`/`PUT /users/me/notification-preferences` -- ruta protegida bajo
 * `/users` (proxeada por el gateway sin cambios en `routes-map.ts`, mismo criterio
 * que `/users/me/password`), el userId sale del header `x-user-id` (ADR-010).
 */
export default async function notificationPreferencesRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const service = createNotificationPreferencesService(app.db);

  app.get(
    "/me/notification-preferences",
    {
      schema: {
        summary: "Preferencias de notificación propias",
        description:
          "AC4 de MOVO-245: toggle maestro, horario de silencio y desglose por categoría " +
          "(solo categorías con al menos un trigger real -- ver NOTIFICATION_CATEGORIES en " +
          "@movo/shared). Una categoría sin fila explícita resuelve a habilitada (AC5).",
        tags: ["users"],
        response: {
          200: notificationPreferencesSchemas.preferencesResponse,
          401: notificationPreferencesSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      return service.getPreferences(userId);
    },
  );

  app.put(
    "/me/notification-preferences",
    {
      schema: {
        summary: "Actualizar preferencias de notificación propias",
        description:
          "Actualización parcial (PATCH semantics sobre PUT, mismo criterio que el resto " +
          "de /users/me/*): cada campo ausente no se toca. `categories` acepta solo ids de " +
          "IMPLEMENTED_NOTIFICATION_CATEGORY_IDS -- 400 VALIDATION_FAILED sobre cualquier otro.",
        tags: ["users"],
        body: notificationPreferencesSchemas.updateBody,
        response: {
          200: notificationPreferencesSchemas.preferencesResponse,
          400: notificationPreferencesSchemas.errorResponse,
          401: notificationPreferencesSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const body = request.body as UpdateNotificationPreferencesInput;
      return service.updatePreferences(userId, body);
    },
  );
}
