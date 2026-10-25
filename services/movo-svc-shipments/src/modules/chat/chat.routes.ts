import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { ApiError, UserRole } from "@movo/shared";
import type { WebSocket } from "ws";
import { chatSchemas } from "./chat.schema";
import { createChatService, ChatService } from "./chat.service";
import { createShipmentRepository, ShipmentRepository } from "../../repositories/shipment-repository";
import { createChatRepository } from "../../repositories/chat-repository";
import { createUsersClient, UsersClient } from "../../adapters/users-client";
import { createNotificationsClient, NotificationsClient } from "../../adapters/notifications-client";
import { createRedisChatPushBuffer } from "../../repositories/chat-push-buffer";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { getUserRolesFromHeader } from "../../utils/get-user-roles";
import { authorizeRealtimeConnection } from "../../services/realtime-authorizer";
import { CHAT_CLOSED_WS_CODE } from "../../plugins/realtime";
import { HEARTBEAT_INTERVAL_MS, TRACKING_TOKEN_EXPIRED_WS_CODE } from "../tracking/tracking.routes";

export interface ChatRoutesOptions extends FastifyPluginOptions {
  /** Overrides solo para tests de integración, mismo criterio que el resto de los módulos. */
  shipmentRepository?: ShipmentRepository;
  usersClient?: UsersClient;
  notificationsClient?: NotificationsClient;
  /** Reloj inyectable para probar el borde de las 24 h. */
  now?: () => Date;
  /** Agenda el resumen de avisos de una ráfaga; los tests lo reemplazan para no esperar la ventana real. */
  schedulePush?: (run: () => void, delayMs: number) => void;
}

const errors = {
  400: chatSchemas.errorResponse,
  401: chatSchemas.errorResponse,
  403: chatSchemas.errorResponse,
  404: chatSchemas.errorResponse,
  409: chatSchemas.errorResponse,
};

/** Arma el servicio con las dependencias reales de la app (o los overrides de test). */
export function buildChatService(app: FastifyInstance, opts: ChatRoutesOptions = {}): ChatService {
  return createChatService({
    shipmentRepository: opts.shipmentRepository ?? createShipmentRepository(app.db),
    chatRepository: createChatRepository(app.db),
    usersClient: opts.usersClient ?? createUsersClient(app.config),
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
 * MOVO-26 (ADR-023): chat de un envío. Se envía por HTTP (`POST .../chat/messages`) y se recibe
 * por WebSocket (`GET .../chat`), igual que la ingesta de posiciones (ADR-020): un POST es robusto
 * ante reintentos y cola offline, y el ack es la propia respuesta. Prefijo `/shipments`.
 */
export default async function chatRoutes(app: FastifyInstance, opts: ChatRoutesOptions) {
  const shipmentRepository = opts.shipmentRepository ?? createShipmentRepository(app.db);
  const service = buildChatService(app, { ...opts, shipmentRepository });

  app.post(
    "/:id/chat/messages",
    {
      schema: {
        summary: "Enviar un mensaje al chat del envío",
        description:
          "MOVO-26: texto de 1 a 1000 caracteres. Idempotente por `clientMessageId` (200 con el " +
          "mensaje ya guardado ante un reenvío, 201 la primera vez). 409 CHAT_CLOSED con el envío " +
          "cancelado, rechazado o sin transportista; 403 CHAT_READ_ONLY para el receptor original, un envío " +
          "entregado (se puede leer y a las 24 h se archiva, nunca se cierra) o en disputa. Un reintento de un " +
          "mensaje ya guardado devuelve 200 con ese mensaje aunque el chat haya cambiado de estado. Un bloqueo (DD-026) " +
          "no impide escribir: a quien tiene un bloqueo con el autor el contenido le llega vacío (`hidden`). " +
          "Las palabras ofensivas se tapan con asteriscos antes de " +
          "guardar y difundir: el mensaje sale igual con `moderated: true` y el cliente le muestra al " +
          "autor el aviso de respeto (`CHAT_MODERATION_WARNING`). Se difunde por el WebSocket del chat.",
        tags: ["chat"],
        params: chatSchemas.shipmentIdParam,
        body: chatSchemas.sendMessageBody,
        response: { 200: chatSchemas.chatMessageResponse, 201: chatSchemas.chatMessageResponse, ...errors, 502: chatSchemas.errorResponse },
      },
    },
    async (request: FastifyRequest, reply) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as { body: string; clientMessageId: string };
      const { message, replayed } = await service.sendMessage({
        shipmentId: id,
        callerId,
        callerRoles,
        body: body.body,
        clientMessageId: body.clientMessageId,
      });
      reply.code(replayed ? 200 : 201);
      return message;
    }
  );

  app.get(
    "/:id/chat/messages",
    {
      schema: {
        summary: "Historial del chat del envío",
        description:
          "MOVO-26: del mensaje más reciente al más antiguo, paginado por cursor opaco. `access` " +
          "dice si quien lo pide puede escribir (`open`) o solo leer (`read_only`). El admin lo lee " +
          "siempre (evidencia de disputa); las partes, mientras el chat esté disponible.",
        tags: ["chat"],
        params: chatSchemas.shipmentIdParam,
        querystring: chatSchemas.listMessagesQuery,
        response: { 200: chatSchemas.listMessagesResponse, ...errors },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      const { limit, cursor } = request.query as { limit: number; cursor?: string };
      return service.listMessages({ shipmentId: id, callerId, callerRoles, limit, cursor });
    }
  );

  app.get(
    "/chats",
    {
      schema: {
        summary: "Mis chats",
        description:
          "MOVO-26: un chat por envío con transportista asignado (en curso, entregado o en disputa), el " +
          "más reciente primero, con el último mensaje, los no leídos y si quedó archivado (entregado hace " +
          "más de 24 h). Un envío cancelado no aparece.",
        tags: ["chat"],
        response: { 200: chatSchemas.chatListResponse, 401: chatSchemas.errorResponse },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      return { items: await service.listChats({ callerId }) };
    }
  );

  app.get(
    "/:id/chat/participants",
    {
      schema: {
        summary: "Integrantes del chat del envío",
        description:
          "MOVO-26: emisor, transportista y receptor con su nombre, foto y rol, para el encabezado " +
          "('Ana, Diego y Luis') y los avatares de la conversación.",
        tags: ["chat"],
        params: chatSchemas.shipmentIdParam,
        response: { 200: chatSchemas.participantsResponse, ...errors },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      return { participants: await service.getParticipants({ shipmentId: id, callerId, callerRoles }) };
    }
  );

  app.post(
    "/:id/chat/read",
    {
      schema: {
        summary: "Marcar el chat como leído",
        description:
          "MOVO-26: quien mira el chat leyó todo hasta ahora. Baja su contador de no leídos y les avisa " +
          "a los demás (`chat_receipt` por el WebSocket) para que vean sus mensajes como leídos. Solo las partes.",
        tags: ["chat"],
        params: chatSchemas.shipmentIdParam,
        response: { 200: chatSchemas.readResponse, ...errors },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      return service.markRead({ shipmentId: id, callerId, callerRoles });
    }
  );

  app.post(
    "/:id/chat/report",
    {
      schema: {
        summary: "Reportar la conversación",
        description:
          "MOVO-26: una por persona y envío (idempotente). La revisa el equipo de Movo; el historial queda " +
          "como evidencia. Solo las partes.",
        tags: ["chat"],
        params: chatSchemas.shipmentIdParam,
        response: { 200: chatSchemas.reportResponse, 201: chatSchemas.reportResponse, ...errors },
      },
    },
    async (request: FastifyRequest, reply) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      const { created } = await service.reportConversation({ shipmentId: id, callerId, callerRoles });
      reply.code(created ? 201 : 200);
      return { reported: true };
    }
  );

  // Canal de recepción: `connected`, `chat_message` y `chat_receipt`. El cliente no manda nada por acá.
  app.get<{ Params: { id: string } }>(
    "/:id/chat",
    { websocket: true, schema: { hide: true } },
    async (socket: WebSocket, request: FastifyRequest<{ Params: { id: string } }>) => {
      const shipmentId = request.params.id;

      let userId: string;
      let tokenExpiresAtMs: number;
      let isAdmin = false;
      let shipment: Awaited<ReturnType<typeof authorizeRealtimeConnection>>["shipment"];
      try {
        const authorized = await authorizeRealtimeConnection(
          shipmentRepository,
          request.headers.authorization,
          shipmentId,
          "No tenés permiso para ver el chat de este envío."
        );
        const access = service.resolveAccess(authorized.shipment, authorized.callerId, authorized.callerRoles);
        if (access === "closed") {
          socket.close(CHAT_CLOSED_WS_CODE, "El chat de este envío ya no está disponible.");
          return;
        }
        userId = authorized.callerId;
        isAdmin = authorized.callerRoles.includes(UserRole.ADMIN);
        tokenExpiresAtMs = authorized.tokenExpiresAtMs;
        shipment = authorized.shipment;
      } catch (err) {
        const statusCode = err instanceof ApiError ? err.statusCode : 500;
        const message = err instanceof ApiError ? err.message : "Error interno.";
        app.log.warn({ err, shipmentId }, "realtime: conexión de chat rechazada");
        const closeCode = statusCode === 401 ? 4001 : statusCode === 403 ? 4003 : statusCode === 404 ? 4004 : 4000;
        socket.close(closeCode, message);
        return;
      }

      // Si el cliente cortó mientras se autorizaba, el `close` ya se disparó: registrar ese socket muerto lo dejaría
      // para siempre en el hub (el usuario figuraría conectado, sin push ni tildes) y sin limpiar sus timers.
      if (socket.readyState !== 1) return;

      app.chatHub.register(shipmentId, userId, socket, { admin: isAdmin });
      app.log.info({ shipmentId, activeConnections: app.chatHub.activeConnections(shipmentId) }, "realtime: conexión de chat aceptada");
      socket.send(JSON.stringify({ type: "connected", shipmentId }));
      // Conectarse cuenta como recibir lo que había: los demás ven sus mensajes como entregados.
      void service.onConnected(shipment, userId).catch((err) =>
        app.log.warn({ err, shipmentId }, "realtime: no se pudo registrar la entrega del chat")
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
        app.chatHub.unregister(shipmentId, userId, socket);
        app.log.info({ shipmentId }, "realtime: cliente de chat desconectado");
      });
      socket.on("error", (err: Error) => {
        app.log.warn({ err, shipmentId }, "realtime: error de socket de chat");
      });
    }
  );
}
