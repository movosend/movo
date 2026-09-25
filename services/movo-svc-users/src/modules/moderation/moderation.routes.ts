import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { createModerationService, ReportUserInput } from "./moderation.service";
import { moderationSchemas } from "./moderation.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";

/**
 * MOVO-175 (ADR-026): reportar y bloquear usuarios. Rutas protegidas bajo `/users`
 * (proxeadas por el gateway sin cambios en `routes-map.ts`, mismo criterio que
 * MOVO-245); el userId sale de `x-user-id` (ADR-010).
 */
export default async function moderationRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const service = createModerationService(app.db, app.redis);

  app.post(
    "/:id/report",
    {
      schema: {
        summary: "Reportar a un usuario",
        description:
          "MOVO-175: persiste un reporte en estado `pending` (la revisión la hace un admin). " +
          "Un solo reporte pendiente por par: reportar de nuevo devuelve 200 con el mismo " +
          "reporte en vez de 201. Máximo 10 reportes nuevos por día por usuario (429).",
        tags: ["users"],
        params: moderationSchemas.userIdParam,
        body: moderationSchemas.reportBody,
        response: {
          200: moderationSchemas.reportResponse,
          201: moderationSchemas.reportResponse,
          400: moderationSchemas.errorResponse,
          401: moderationSchemas.errorResponse,
          404: moderationSchemas.errorResponse,
          429: moderationSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const { report, created } = await service.reportUser(callerId, id, request.body as ReportUserInput);
      reply.code(created ? 201 : 200);
      return {
        id: report.id,
        reportedId: report.reportedId,
        reason: report.reason,
        details: report.details,
        status: report.status,
        createdAt: report.createdAt.toISOString(),
      };
    },
  );

  app.post(
    "/:id/block",
    {
      schema: {
        summary: "Bloquear a un usuario",
        description:
          "MOVO-175 (ADR-026): idempotente. El efecto es simétrico: ninguno de los dos ve " +
          "al otro en listados ni puede iniciar envíos/ofertas con el otro. Los envíos ya " +
          "en curso entre ambos no se cancelan.",
        tags: ["users"],
        params: moderationSchemas.userIdParam,
        response: {
          204: moderationSchemas.noContent,
          400: moderationSchemas.errorResponse,
          401: moderationSchemas.errorResponse,
          404: moderationSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      await service.blockUser(callerId, id);
      reply.code(204);
    },
  );

  app.delete(
    "/:id/block",
    {
      schema: {
        summary: "Desbloquear a un usuario",
        description: "MOVO-175: idempotente -- desbloquear a alguien no bloqueado responde 204 igual.",
        tags: ["users"],
        params: moderationSchemas.userIdParam,
        response: {
          204: moderationSchemas.noContent,
          400: moderationSchemas.errorResponse,
          401: moderationSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      await service.unblockUser(callerId, id);
      reply.code(204);
    },
  );

  app.get(
    "/me/blocked",
    {
      schema: {
        summary: "Usuarios bloqueados propios",
        description:
          "MOVO-175: usuarios que el caller bloqueó, del más reciente al más viejo. Nunca " +
          "expone quién bloqueó al caller.",
        tags: ["users"],
        response: {
          200: moderationSchemas.blockedListResponse,
          401: moderationSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      return service.listBlocked(callerId);
    },
  );
}

/**
 * MOVO-175: consultado por `movo-svc-shipments` para aplicar el bloqueo a
 * envíos/ofertas. Interno -- no se declara en `gateway/src/config/routes-map.ts`,
 * mismo criterio que `/internal/users/:id/device-key` (MOVO-157).
 */
export async function internalModerationRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const service = createModerationService(app.db, app.redis);

  app.get(
    "/users/:id/block-relations",
    {
      schema: {
        hide: true,
        params: moderationSchemas.userIdParam,
        response: {
          200: moderationSchemas.blockRelationsResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      return { userIds: await service.listRelatedUserIds(id) };
    },
  );
}
