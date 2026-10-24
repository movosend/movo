import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { ApiError, SupportCreateBody, SupportUserAttachmentCreateBody, SUPPORT_WS_CLOSE } from "@movo/shared";
import type { WebSocket } from "ws";
import { supportSchemas } from "./support.schema";
import { createSupportService, SupportService } from "./support.service";
import { createSupportAttachmentsService } from "./support-attachments.service";
import { createShipmentRepository, ShipmentRepository } from "../../repositories/shipment-repository";
import { createSupportRepository } from "../../repositories/support-repository";
import { createSupportAttachmentRepository } from "../../repositories/support-attachment-repository";
import { createStorageProvider, StorageProvider } from "../../adapters/storage-provider";
import { createNotificationsClient, NotificationsClient } from "../../adapters/notifications-client";
import { createRedisChatPushBuffer } from "../../repositories/chat-push-buffer";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { supportRoomKey } from "../../domain/support-rules";
import { HEARTBEAT_INTERVAL_MS, TRACKING_TOKEN_EXPIRED_WS_CODE } from "../tracking/tracking.routes";

export interface SupportRoutesOptions extends FastifyPluginOptions {
  /** Overrides solo para tests de integración, mismo criterio que el resto de los módulos. */
  shipmentRepository?: ShipmentRepository;
  notificationsClient?: NotificationsClient;
  /** MOVO-321: storage de los adjuntos (el mock en tests, para simular la subida con `__simulateUpload`). */
  storageProvider?: StorageProvider;
  /** Reloj inyectable. */
  now?: () => Date;
  /** Agenda el resumen de avisos de una ráfaga; los tests lo reemplazan para no esperar la ventana real. */
  schedulePush?: (run: () => void, delayMs: number) => void;
}

const errors = {
  400: supportSchemas.errorResponse,
  401: supportSchemas.errorResponse,
  404: supportSchemas.errorResponse,
  422: supportSchemas.errorResponse,
};

/** Arma el servicio con las dependencias reales de la app (o los overrides de test). */
export function buildSupportService(app: FastifyInstance, opts: SupportRoutesOptions = {}): SupportService {
  return createSupportService({
    supportRepository: createSupportRepository(app.db),
    attachments: createSupportAttachmentsService({
      repository: createSupportAttachmentRepository(app.db),
      storage: opts.storageProvider ?? createStorageProvider(app.config),
      ...(opts.now ? { now: opts.now } : {}),
    }),
    shipmentRepository: opts.shipmentRepository ?? createShipmentRepository(app.db),
    notificationsClient: opts.notificationsClient ?? createNotificationsClient(app.config),
    hub: app.chatHub,
    claimNotificationOnce: async (key, ttlSeconds) =>
      (await app.redis.set(`notified:${key}`, "1", "EX", ttlSeconds, "NX")) === "OK",
    releaseNotificationClaim: async (key) => {
      await app.redis.del(`notified:${key}`);
    },
    windowRemainingMs: async (key) => Math.max(0, await app.redis.pttl(`notified:${key}`)),
    pushBuffer: createRedisChatPushBuffer(app.redis),
    schedule: opts.schedulePush,
    logger: app.log,
    now: opts.now,
  });
}

/**
 * MOVO-320 (ADR-051): soporte al usuario sobre el chat existente. Se escribe por HTTP (idempotente por
 * `clientMessageId`) y se recibe por WebSocket (`GET /conversations/:id`), igual que el chat del envío (ADR-040).
 * Prefijo `/support`. Las notas internas del equipo nunca llegan por ninguna de estas rutas.
 */
export default async function supportRoutes(app: FastifyInstance, opts: SupportRoutesOptions) {
  const service = buildSupportService(app, opts);

  app.post(
    "/conversations",
    {
      schema: {
        summary: "Abrir una consulta a soporte",
        description:
          "MOVO-320: crea la consulta y su primer mensaje en una transacción. `shipmentId` es opcional (sin él es una " +
          "consulta libre); si viene, el usuario tiene que ser parte del envío o responde 422 SUPPORT_SHIPMENT_NOT_PARTY. " +
          "Idempotente por `clientMessageId`: 201 la primera vez, 200 con lo ya creado ante un reenvío. Las palabras " +
          "ofensivas se tapan con asteriscos (`moderated: true`). MOVO-321: `attachmentIds` (hasta 4, de " +
          "`POST /support/attachments` sin `conversationId`, ya subidos); con adjuntos `body` puede ir vacío. Uno ajeno, " +
          "ya usado, de otra consulta o que no está en el bucket con el tipo y tamaño declarados responde 422 " +
          "SUPPORT_ATTACHMENT_INVALID.",
        tags: ["support"],
        body: supportSchemas.createConversationBody,
        response: { 200: supportSchemas.createConversationResponse, 201: supportSchemas.createConversationResponse, ...errors },
      },
    },
    async (request: FastifyRequest, reply) => {
      const userId = requireUserIdFromHeader(request);
      const { replayed, ...result } = await service.createConversation(userId, request.body as SupportCreateBody);
      reply.code(replayed ? 200 : 201);
      return result;
    }
  );

  app.get(
    "/conversations",
    {
      schema: {
        summary: "Mis consultas a soporte",
        description:
          "MOVO-320: solo las del usuario autenticado, la de actividad más reciente primero, con estado, tema, envío " +
          "vinculado, último mensaje visible (nunca una nota ni un evento del sistema) y mensajes sin leer.",
        tags: ["support"],
        response: { 200: supportSchemas.listConversationsResponse, 401: supportSchemas.errorResponse },
      },
    },
    async (request: FastifyRequest) => service.listConversations(requireUserIdFromHeader(request))
  );

  app.get(
    "/conversations/:id/messages",
    {
      schema: {
        summary: "Historial de una consulta",
        description:
          "MOVO-320: del más reciente al más antiguo, con cursor opaco (`nextCursor`). Solo lo que ve el usuario: las " +
          "notas internas nunca se incluyen. Trae también `conversation` para el encabezado. Una consulta ajena o " +
          "inexistente responde 404 (no se filtra su existencia).",
        tags: ["support"],
        params: supportSchemas.conversationIdParam,
        querystring: supportSchemas.listMessagesQuery,
        response: { 200: supportSchemas.listMessagesResponse, ...errors },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const { limit, cursor } = request.query as { limit: number; cursor?: string };
      return service.getMessages({ userId, conversationId: id, limit, cursor });
    }
  );

  app.post(
    "/conversations/:id/messages",
    {
      schema: {
        summary: "Escribir en una consulta",
        description:
          "MOVO-320: idempotente por `clientMessageId` (201 la primera vez, 200 ante un reenvío). Si la consulta estaba " +
          "`resolved` se reabre (`open`) y queda un mensaje `system` \"Se reabrió la conversación\"; una `awaiting_user` " +
          "pasa a `open`. Se difunde por el WebSocket de la consulta. Las palabras ofensivas se tapan (`moderated: true`). " +
          "MOVO-321: `attachmentIds` (hasta 4, subidos por el usuario para esta consulta o sin consulta); con adjuntos " +
          "`body` puede ir vacío. Inválidos → 422 SUPPORT_ATTACHMENT_INVALID.",
        tags: ["support"],
        params: supportSchemas.conversationIdParam,
        body: supportSchemas.sendMessageBody,
        response: { 200: supportSchemas.supportMessageResponse, 201: supportSchemas.supportMessageResponse, ...errors },
      },
    },
    async (request: FastifyRequest, reply) => {
      const userId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as { body: string; clientMessageId: string; attachmentIds?: string[] };
      const { message, replayed } = await service.sendMessage({
        userId,
        conversationId: id,
        body: body.body,
        clientMessageId: body.clientMessageId,
        attachmentIds: body.attachmentIds,
      });
      reply.code(replayed ? 200 : 201);
      return message;
    }
  );

  app.post(
    "/attachments",
    {
      schema: {
        summary: "Pedir una URL para subir una imagen a soporte",
        description:
          "MOVO-321: solo `image/jpeg`, `image/png` o `image/webp` de hasta 5 MB (si no, 422 SUPPORT_ATTACHMENT_INVALID). " +
          "Devuelve una URL de `PUT` firmada con ese tipo y tamaño: la app sube el binario con el mismo `Content-Type`, " +
          "directo al bucket privado. Con `conversationId` la consulta tiene que ser del usuario (404 si no); sin él es " +
          "una foto de una consulta nueva y se asocia al crearla. Si nunca se usa en un mensaje, se borra sola. " +
          "`width`/`height` (px, opcionales) se devuelven con el adjunto. Al leer, cada adjunto trae una `url` firmada " +
          "de 15 min.",
        tags: ["support"],
        body: supportSchemas.createAttachmentBody,
        response: { 201: supportSchemas.createAttachmentResponse, ...errors },
      },
    },
    async (request: FastifyRequest, reply) => {
      const userId = requireUserIdFromHeader(request);
      const result = await service.createAttachment(userId, request.body as SupportUserAttachmentCreateBody);
      reply.code(201);
      return result;
    }
  );

  app.post(
    "/conversations/:id/read",
    {
      schema: {
        summary: "Marcar una consulta como leída",
        description: "MOVO-320: baja a cero el contador de mensajes sin leer de la consulta.",
        tags: ["support"],
        params: supportSchemas.conversationIdParam,
        response: { 200: supportSchemas.readResponse, 401: supportSchemas.errorResponse, 404: supportSchemas.errorResponse },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      return service.markRead(userId, id);
    }
  );

  // Canal de recepción: `connected`, `support_message`, `support_status` y `support_receipt`. El cliente no manda
  // nada por acá. Cierres: 4001 token, 4003 sin permiso, 4004 no existe.
  app.get<{ Params: { id: string } }>(
    "/conversations/:id",
    { websocket: true, schema: { hide: true } },
    async (socket: WebSocket, request: FastifyRequest<{ Params: { id: string } }>) => {
      const conversationId = request.params.id;

      let userId: string;
      let tokenExpiresAtMs: number;
      try {
        const authorized = await service.authorizeConnection(request.headers.authorization, conversationId);
        userId = authorized.callerId;
        tokenExpiresAtMs = authorized.tokenExpiresAtMs;
      } catch (err) {
        const statusCode = err instanceof ApiError ? err.statusCode : 500;
        const message = err instanceof ApiError ? err.message : "Error interno.";
        app.log.warn({ err, conversationId }, "realtime: conexión de soporte rechazada");
        const closeCode =
          statusCode === 401
            ? SUPPORT_WS_CLOSE.TOKEN
            : statusCode === 403
              ? SUPPORT_WS_CLOSE.FORBIDDEN
              : statusCode === 404
                ? SUPPORT_WS_CLOSE.NOT_FOUND
                : 4000;
        socket.close(closeCode, message);
        return;
      }

      // Si el cliente cortó mientras se autorizaba, el `close` ya se disparó: registrar ese socket muerto lo dejaría
      // para siempre en el hub (el usuario figuraría conectado, sin push) y sin limpiar sus timers.
      if (socket.readyState !== 1) return;

      const room = supportRoomKey(conversationId);
      app.chatHub.register(room, userId, socket);
      app.log.info({ conversationId, activeConnections: app.chatHub.activeConnections(room) }, "realtime: conexión de soporte aceptada");
      socket.send(JSON.stringify({ type: "connected", conversationId }));
      void service.onConnected(conversationId, userId).catch((err) =>
        app.log.warn({ err, conversationId }, "realtime: no se pudo registrar la entrega de soporte")
      );

      // El JWT se valida al conectar; al llegar su `exp` se corta con 4001 y el cliente reconecta.
      const MAX_TIMER_MS = 2 ** 31 - 1;
      const expiryTimer = setTimeout(
        () => socket.close(TRACKING_TOKEN_EXPIRED_WS_CODE, "Token vencido."),
        Math.min(Math.max(tokenExpiresAtMs - Date.now(), 0), MAX_TIMER_MS)
      );
      expiryTimer.unref();

      let isAlive = true;
      socket.on("pong", () => {
        isAlive = true;
      });
      const heartbeat = setInterval(() => {
        if (!isAlive) {
          socket.terminate();
          return;
        }
        isAlive = false;
        socket.ping();
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref();

      socket.on("close", () => {
        clearInterval(heartbeat);
        clearTimeout(expiryTimer);
        app.chatHub.unregister(room, userId, socket);
        app.log.info({ conversationId }, "realtime: cliente de soporte desconectado");
      });
      socket.on("error", (err: Error) => {
        app.log.warn({ err, conversationId }, "realtime: error de socket de soporte");
      });
    }
  );
}
