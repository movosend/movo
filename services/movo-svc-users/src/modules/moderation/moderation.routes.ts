import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { UserReportPhoto, UserReportSummary } from "@movo/shared";
import {
  AddReportEntryInput,
  createModerationService,
  ReportPhotoUploadInput,
  ReportUserInput,
} from "./moderation.service";
import { moderationSchemas } from "./moderation.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { UserReportPhotoRecord, UserReportRecord } from "../../repositories/moderation-repository";
import { createStorageProvider, StorageProvider } from "../../adapters/storage-provider";

export interface ModerationRoutesOptions extends FastifyPluginOptions {
  /** MOVO-256: override para tests (mock en memoria), mismo criterio que `usersRoutes`. */
  storageProvider?: StorageProvider;
}

/** MOVO-256: cada foto sale con una presigned GET nueva -- el prefijo `reports/*` es
 * privado, no hay URL estable que persistir ni devolver. */
async function toReportDto(report: UserReportRecord, storage: StorageProvider): Promise<UserReportSummary> {
  const toPhotos = (photos: UserReportPhotoRecord[]): Promise<UserReportPhoto[]> =>
    Promise.all(
      photos.map(async (photo) => {
        const { url, expiresIn } = await storage.createDownloadUrl(photo.s3Key);
        return { id: photo.id, url, expiresIn };
      }),
    );
  return {
    id: report.id,
    reportedId: report.reportedId,
    reason: report.reason,
    details: report.details,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
    photos: await toPhotos(report.photos),
    entries: await Promise.all(
      report.entries.map(async (entry) => ({
        id: entry.id,
        details: entry.details,
        createdAt: entry.createdAt.toISOString(),
        photos: await toPhotos(entry.photos),
      })),
    ),
  };
}

/**
 * MOVO-175 (ADR-026): reportar y bloquear usuarios. Rutas protegidas bajo `/users`
 * (proxeadas por el gateway sin cambios en `routes-map.ts`, mismo criterio que
 * MOVO-245); el userId sale de `x-user-id` (ADR-010).
 */
export default async function moderationRoutes(app: FastifyInstance, opts: ModerationRoutesOptions) {
  const storageProvider = opts.storageProvider ?? createStorageProvider(app.config);
  const service = createModerationService(app.db, app.redis, storageProvider, app.log);

  app.post(
    "/:id/report/photos/presign",
    {
      schema: {
        summary: "Presigned URL para una foto de reporte",
        description:
          "MOVO-256: presigned PUT (JPEG, máx. 2 MB) para una foto de evidencia. La key " +
          "la genera el servidor bajo el prefijo privado `reports/{callerId}/`. La foto " +
          "se asocia al mandar el reporte o una entrada con `photoKeys`; si nunca se " +
          "asocia, el sweep de huérfanas la borra. No consume cupo diario.",
        tags: ["users"],
        params: moderationSchemas.userIdParam,
        body: moderationSchemas.reportPhotoUploadBody,
        response: {
          200: moderationSchemas.reportPhotoUploadResponse,
          400: moderationSchemas.errorResponse,
          401: moderationSchemas.errorResponse,
          502: moderationSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      return service.getReportPhotoUploadUrl(callerId, id, request.body as ReportPhotoUploadInput);
    },
  );

  app.post(
    "/:id/report",
    {
      schema: {
        summary: "Reportar a un usuario",
        description:
          "MOVO-175: persiste un reporte en estado `pending` (la revisión la hace un admin). " +
          "Un solo reporte pendiente por par: si ya hay uno, 409 `REPORT_ALREADY_PENDING` " +
          "(se le suma información con `POST /users/:id/report/entries`). Máximo 10 " +
          "reportes o entradas por día por usuario (429). MOVO-256: `photoKeys` (hasta 4) " +
          "asocia fotos ya subidas; 403 si una key no es del caller, 422 si no existe en " +
          "el storage, 409 `REPORT_PHOTO_ALREADY_USED` si ya está en otro envío.",
        tags: ["users"],
        params: moderationSchemas.userIdParam,
        body: moderationSchemas.reportBody,
        response: {
          201: moderationSchemas.reportResponse,
          400: moderationSchemas.errorResponse,
          401: moderationSchemas.errorResponse,
          403: moderationSchemas.errorResponse,
          404: moderationSchemas.errorResponse,
          409: moderationSchemas.errorResponse,
          422: moderationSchemas.errorResponse,
          429: moderationSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const report = await service.reportUser(callerId, id, request.body as ReportUserInput);
      reply.code(201);
      return toReportDto(report, storageProvider);
    },
  );

  app.get(
    "/:id/report",
    {
      schema: {
        summary: "Reporte propio en revisión sobre un usuario",
        description:
          "MOVO-175: el reporte `pending` que el caller hizo sobre `:id`, con la información " +
          "sumada después, o `null` si no tiene ninguno. Nunca expone reportes de terceros. " +
          "MOVO-256: cada foto trae una presigned GET de TTL corto (`expiresIn`).",
        tags: ["users"],
        params: moderationSchemas.userIdParam,
        response: {
          200: moderationSchemas.reportOrNullResponse,
          400: moderationSchemas.errorResponse,
          401: moderationSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const report = await service.getPendingReport(callerId, id);
      return report ? toReportDto(report, storageProvider) : null;
    },
  );

  app.post(
    "/:id/report/entries",
    {
      schema: {
        summary: "Sumar información a un reporte en revisión",
        description:
          "MOVO-175: agrega una entrada al reporte `pending` propio sobre `:id`. El reporte " +
          "original no se edita. Consume el mismo cupo diario que un reporte nuevo (429); " +
          "404 `REPORT_NOT_FOUND` si no hay un reporte en revisión. MOVO-256: texto " +
          "(`details`), fotos (`photoKeys`, mismas reglas que en el reporte) o ambos.",
        tags: ["users"],
        params: moderationSchemas.userIdParam,
        body: moderationSchemas.reportEntryBody,
        response: {
          201: moderationSchemas.reportResponse,
          400: moderationSchemas.errorResponse,
          401: moderationSchemas.errorResponse,
          403: moderationSchemas.errorResponse,
          404: moderationSchemas.errorResponse,
          409: moderationSchemas.errorResponse,
          422: moderationSchemas.errorResponse,
          429: moderationSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const report = await service.addReportEntry(callerId, id, request.body as AddReportEntryInput);
      reply.code(201);
      return toReportDto(report, storageProvider);
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
export async function internalModerationRoutes(app: FastifyInstance, opts: ModerationRoutesOptions) {
  const service = createModerationService(
    app.db,
    app.redis,
    opts.storageProvider ?? createStorageProvider(app.config),
    app.log,
  );

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
