import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  SupportInternalActor,
  SupportInternalAttachmentBody,
  SupportInternalListQuery,
  SupportInternalPatchBody,
  SupportInternalSendBody,
  SupportStatus,
} from "@movo/shared";
import { adminSupportSchemas as schemas } from "./admin-support.schema";
import { createAdminSupportService } from "./admin-support.service";
import { createSupportAdminFeed } from "./support-admin-feed";
import { createSupportAdminRepository } from "../../repositories/support-admin-repository";
import { createSupportAttachmentRepository } from "../../repositories/support-attachment-repository";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createStorageProvider, StorageProvider } from "../../adapters/storage-provider";
import { NotificationsClient } from "../../adapters/notifications-client";
import { createRedisSupportEventStream, SupportEventStream } from "../../realtime/support-event-stream";
import { createSupportAttachmentsService } from "../support/support-attachments.service";
import { buildSupportService } from "../support/support.routes";

export interface AdminSupportRoutesOptions extends FastifyPluginOptions {
  /** Overrides solo para tests de integración, mismo criterio que el resto de los módulos. */
  storageProvider?: StorageProvider;
  notificationsClient?: NotificationsClient;
  eventStream?: SupportEventStream;
  now?: () => Date;
  schedulePush?: (run: () => void, delayMs: number) => void;
}

const errors = {
  400: schemas.errorResponse,
  404: schemas.errorResponse,
  422: schemas.errorResponse,
};

interface RawListQuery {
  status: SupportStatus;
  assignee?: string;
  q?: string;
  userIds?: string;
  cursor?: string;
}

/** `userIds` viaja como ids separados por coma (los que coinciden con `q` en `svc-users`). */
function listQueryOf(raw: RawListQuery): SupportInternalListQuery {
  const userIds = raw.userIds
    ?.split(",")
    .map((id) => id.trim())
    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  return {
    status: raw.status,
    ...(raw.assignee ? { assignee: raw.assignee } : {}),
    ...(raw.q ? { q: raw.q } : {}),
    ...(userIds && userIds.length > 0 ? { userIds } : {}),
    ...(raw.cursor ? { cursor: raw.cursor } : {}),
  };
}

const idOf = (request: FastifyRequest) => (request.params as { id: string }).id;

/**
 * MOVO-322: el lado del agente de la bandeja de soporte, para `svc-admin` (prefijo `/internal/admin/support`, solo red
 * Docker, sin `x-user-*`: el rol, la regla de conflicto de interés y la bitácora los aplica `svc-admin`, que manda
 * quién actúa en el body). Cada escritura avisa al usuario (sin notas ni eventos del equipo) y al panel (Redis Stream,
 * ADR-024).
 */
export default async function adminSupportRoutes(app: FastifyInstance, opts: AdminSupportRoutesOptions) {
  const storage = opts.storageProvider ?? createStorageProvider(app.config);
  const attachments = createSupportAttachmentsService({
    repository: createSupportAttachmentRepository(app.db),
    storage,
    ...(opts.now ? { now: opts.now } : {}),
  });
  const repository = createSupportAdminRepository(app.db);
  // Un solo feed para las dos puntas: el stream inyectado en tests cubre también lo que publica `userSide`.
  const feed = createSupportAdminFeed({
    repository,
    attachments,
    stream: opts.eventStream ?? createRedisSupportEventStream(app.redis),
    logger: app.log,
    ...(opts.now ? { now: opts.now } : {}),
  });
  const service = createAdminSupportService({
    repository,
    attachments,
    shipmentRepository: createShipmentRepository(app.db),
    userSide: buildSupportService(
      app,
      {
        storageProvider: storage,
        ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
        ...(opts.now ? { now: opts.now } : {}),
        ...(opts.schedulePush ? { schedulePush: opts.schedulePush } : {}),
      },
      { attachments, adminFeed: feed }
    ),
    feed,
    logger: app.log,
    ...(opts.now ? { now: opts.now } : {}),
  });

  const tags = ["internal-admin-support"];

  app.get(
    "/conversations",
    {
      schema: {
        summary: "Bandeja de soporte (interno, para svc-admin)",
        description:
          "MOVO-322 AC2: por estado (obligatorio), agente (`none` o un id), búsqueda (`q`: código SOP, código del envío, " +
          "texto de los mensajes, o `userIds` que coinciden por nombre) y cursor. Abiertas y esperando: prioridad y " +
          "después mayor espera; resueltas: última actividad. Páginas de 30.",
        tags,
        querystring: schemas.listQuery,
        response: { 200: schemas.listResponse, 400: schemas.errorResponse },
      },
    },
    async (request) => service.list(listQueryOf(request.query as RawListQuery))
  );

  app.get(
    "/counts",
    {
      schema: {
        summary: "Contadores de la bandeja (interno)",
        description:
          "MOVO-322 AC3: `byStatus` respeta agente y búsqueda; `byOwner` (todos/míos/sin asignar, `mine` de `viewerId`) " +
          "respeta estado y búsqueda; `unreadTotal` es global.",
        tags,
        querystring: schemas.countsQuery,
        response: { 200: schemas.countsResponse, 400: schemas.errorResponse },
      },
    },
    async (request) => {
      const raw = request.query as RawListQuery & { viewerId: string };
      return service.counts({ ...listQueryOf({ ...raw, cursor: undefined }), viewerId: raw.viewerId });
    }
  );

  app.get(
    "/agents/load",
    {
      schema: {
        summary: "Consultas no resueltas asignadas por agente (interno)",
        tags,
        response: { 200: schemas.agentLoadsResponse },
      },
    },
    async () => service.agentLoads()
  );

  app.get(
    "/conversations/:id",
    {
      schema: {
        summary: "Una consulta de soporte (interno)",
        tags,
        params: schemas.conversationIdParam,
        response: { 200: schemas.row, 404: schemas.errorResponse },
      },
    },
    async (request) => service.get(idOf(request))
  );

  app.get(
    "/conversations/:id/messages",
    {
      schema: {
        summary: "Historial completo de una consulta (interno)",
        description: "MOVO-322 AC4: todos los `kind` (notas y eventos del equipo incluidos), más recientes primero, de a 50.",
        tags,
        params: schemas.conversationIdParam,
        querystring: schemas.messagesQuery,
        response: { 200: schemas.messagesResponse, ...errors },
      },
    },
    async (request) => service.messages(idOf(request), (request.query as { cursor?: string }).cursor)
  );

  app.post(
    "/conversations/:id/messages",
    {
      schema: {
        summary: "Responder o dejar una nota interna (interno)",
        description:
          "MOVO-322 AC5: `internal: true` es una nota (nunca llega al usuario). Una respuesta pasa la consulta a " +
          "`awaiting_user`, la toma si estaba sin asignar y reabre una resuelta, con sus eventos. Idempotente por " +
          "`clientMessageId`. Adjuntos del agente (MOVO-321) en `attachmentIds`.",
        tags,
        params: schemas.conversationIdParam,
        body: schemas.sendBody,
        response: { 200: schemas.sendResponse, ...errors },
      },
    },
    async (request) => service.send(idOf(request), request.body as SupportInternalSendBody)
  );

  app.patch(
    "/conversations/:id",
    {
      schema: {
        summary: "Asignar, priorizar, cambiar tema, etiquetar o vincular un envío (interno)",
        description:
          "MOVO-322 AC6/AC7: cada cambio de asignación, prioridad, tema o envío deja un evento del equipo; las etiquetas no. " +
          "Vincular un envío del que el usuario no es parte responde 422 SUPPORT_SHIPMENT_NOT_PARTY.",
        tags,
        params: schemas.conversationIdParam,
        body: schemas.patchBody,
        response: { 200: schemas.row, ...errors },
      },
    },
    async (request) => service.patch(idOf(request), request.body as SupportInternalPatchBody)
  );

  for (const [path, resolved] of [
    ["/conversations/:id/resolve", true],
    ["/conversations/:id/reopen", false],
  ] as const) {
    app.post(
      path,
      {
        schema: {
          summary: resolved ? "Resolver una consulta (interno)" : "Reabrir una consulta (interno)",
          description: "MOVO-322 AC8: con su evento del equipo; el usuario ve el cambio de estado. Idempotente.",
          tags,
          params: schemas.conversationIdParam,
          body: schemas.actorBody,
          response: { 200: schemas.row, 404: schemas.errorResponse },
        },
      },
      async (request) => service.setResolved(idOf(request), request.body as SupportInternalActor, resolved)
    );
  }

  app.post(
    "/conversations/:id/read",
    {
      schema: {
        summary: "Un agente abrió la consulta (interno)",
        description: "No leídos compartidos a cero y tildes \"leído\" para el usuario. Es una lectura: no va a la bitácora.",
        tags,
        params: schemas.conversationIdParam,
        response: { 204: { type: "null" }, 404: schemas.errorResponse },
      },
    },
    async (request, reply) => {
      await service.read(idOf(request));
      reply.code(204);
    }
  );

  app.get(
    "/conversations/:id/parties",
    {
      schema: {
        summary: "Usuario de la consulta, para la regla de conflicto de interés (interno)",
        tags,
        params: schemas.conversationIdParam,
        response: { 200: schemas.partiesResponse, 404: schemas.errorResponse },
      },
    },
    async (request) => service.parties(idOf(request))
  );

  app.get(
    "/conversations/:id/user-conversations",
    {
      schema: {
        summary: "Las demás consultas del mismo usuario (interno)",
        tags,
        params: schemas.conversationIdParam,
        response: { 200: schemas.userConversationsResponse, 404: schemas.errorResponse },
      },
    },
    async (request) => service.userConversations(idOf(request))
  );

  app.post(
    "/conversations/:id/attachments",
    {
      schema: {
        summary: "URL de subida de un adjunto del agente (interno)",
        description: "MOVO-321 desde el panel: mismas reglas que el lado del usuario, en el prefijo privado de la consulta.",
        tags,
        params: schemas.conversationIdParam,
        body: schemas.attachmentBody,
        response: { 201: schemas.attachmentResponse, 404: schemas.errorResponse, 422: schemas.errorResponse, 429: schemas.errorResponse },
      },
    },
    async (request, reply) => {
      const result = await service.createAttachment(idOf(request), request.body as SupportInternalAttachmentBody);
      reply.code(201);
      return result;
    }
  );
}
