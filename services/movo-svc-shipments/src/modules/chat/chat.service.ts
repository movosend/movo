import {
  ApiError,
  ChatAccess,
  ChatMessage,
  ChatMessagesPage,
  ChatRealtimeEvent,
  CHAT_MESSAGE_MAX_LENGTH,
  notificationTriggerCategory,
  renderNotificationTrigger,
  UserRole,
} from "@movo/shared";
import { ChatMessageRecord, ChatRepository, InvalidChatCursorError } from "../../repositories/chat-repository";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { UsersClient } from "../../adapters/users-client";
import { NotificationsClient } from "../../adapters/notifications-client";
import { ChatHub } from "../../realtime/chat-hub";
import { assertShipmentAccess } from "../shipments/assert-shipment-access";
import { assertNotBlocked } from "../../utils/block-relations";
import { resolveChatAccess } from "../../domain/chat-window";
import { moderateChatText } from "../../domain/chat-moderation";
import { Shipment } from "../../models/shipment";

type ChatLogger = { warn: (obj: unknown, msg?: string) => void };

/** Una ráfaga de mensajes avisa una sola vez por destinatario durante este tiempo. */
const CHAT_PUSH_COOLDOWN_SECONDS = 60;

export interface ChatServiceDeps {
  shipmentRepository: ShipmentRepository;
  chatRepository: ChatRepository;
  usersClient: UsersClient;
  notificationsClient: NotificationsClient;
  hub: ChatHub;
  /** `SET NX` en Redis: true si esta llamada ganó la marca (primer aviso de la ráfaga). */
  claimNotificationOnce: (key: string, ttlSeconds: number) => Promise<boolean>;
  releaseNotificationClaim: (key: string) => Promise<void>;
  logger?: ChatLogger;
  now?: () => Date;
}

export function toChatMessageDto(record: ChatMessageRecord): ChatMessage {
  return {
    id: record.id,
    shipmentId: record.shipmentId,
    authorId: record.authorId,
    body: record.body,
    clientMessageId: record.clientMessageId,
    moderated: record.moderated,
    createdAt: record.createdAt.toISOString(),
  };
}

/** Quienes escriben en el hilo: emisor, receptor vigente y transportista asignado. */
function chatParticipantIds(shipment: Shipment): string[] {
  return [...new Set([shipment.senderId, shipment.receiverId, shipment.carrierId].filter((id): id is string => Boolean(id)))];
}

export function createChatService(deps: ChatServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function loadShipmentForViewer(shipmentId: string, callerId: string, callerRoles: UserRole[]): Promise<Shipment> {
    const shipment = await deps.shipmentRepository.findById(shipmentId);
    if (!shipment) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
    assertShipmentAccess(shipment, callerId, callerRoles, "No tenés permiso para ver el chat de este envío.");
    return shipment;
  }

  function accessFor(shipment: Shipment, callerId: string, callerRoles: UserRole[]): ChatAccess {
    return resolveChatAccess({ shipment, viewerId: callerId, viewerRoles: callerRoles, now: now() });
  }

  async function dispatchPushes(shipment: Shipment, authorId: string): Promise<void> {
    const recipients = chatParticipantIds(shipment).filter(
      (id) => id !== authorId && !deps.hub.isUserConnected(shipment.id, id)
    );
    if (recipients.length === 0) return;

    let authorName = "Alguien";
    try {
      authorName = (await deps.usersClient.findPublicProfile(authorId, authorId))?.fullName ?? authorName;
    } catch (err) {
      deps.logger?.warn({ err, event: "chat_author_name_failed", shipmentId: shipment.id }, "No se pudo resolver el nombre del autor");
    }

    await Promise.all(
      recipients.map(async (userId) => {
        const claimKey = `chat-push:${shipment.id}:${userId}`;
        if (!(await deps.claimNotificationOnce(claimKey, CHAT_PUSH_COOLDOWN_SECONDS))) return;
        try {
          const copy = renderNotificationTrigger("chatMessageReceived", { authorName });
          await deps.notificationsClient.sendPush({
            userId,
            title: copy.title,
            body: copy.body,
            category: notificationTriggerCategory("chatMessageReceived"),
            data: { type: "chat_message", shipmentId: shipment.id },
          });
        } catch (err) {
          await deps.releaseNotificationClaim(claimKey).catch(() => undefined);
          deps.logger?.warn(
            { err, event: "chat_push_failed", shipmentId: shipment.id, userId },
            "No se pudo notificar el mensaje de chat"
          );
        }
      })
    );
  }

  return {
    /**
     * Envía un mensaje. Idempotente por `clientMessageId`: un reenvío devuelve el mensaje ya
     * guardado (`replayed: true`) sin volver a difundirlo ni a notificar.
     */
    async sendMessage(input: {
      shipmentId: string;
      callerId: string;
      callerRoles: UserRole[];
      body: string;
      clientMessageId: string;
    }): Promise<{ message: ChatMessage; replayed: boolean }> {
      const shipment = await loadShipmentForViewer(input.shipmentId, input.callerId, input.callerRoles);

      const access = accessFor(shipment, input.callerId, input.callerRoles);
      if (access === "closed") {
        throw new ApiError(409, "CHAT_CLOSED", "El chat de este envío ya no está disponible.");
      }
      if (access === "read_only") {
        throw new ApiError(403, "CHAT_READ_ONLY", "No podés enviar mensajes en este chat.");
      }

      const body = input.body.trim();
      if (body.length < 1 || body.length > CHAT_MESSAGE_MAX_LENGTH) {
        throw new ApiError(400, "VALIDATION_FAILED", `El mensaje debe tener entre 1 y ${CHAT_MESSAGE_MAX_LENGTH} caracteres.`);
      }

      // ADR-026: un bloqueo con cualquiera de las otras partes corta la escritura (falla cerrado).
      await assertNotBlocked(deps.usersClient, input.callerId, chatParticipantIds(shipment));

      // Se guarda y se difunde el texto ya enmascarado: nadie más llega a ver la palabra.
      const moderation = moderateChatText(body);
      const { message, created } = await deps.chatRepository.create({
        shipmentId: shipment.id,
        authorId: input.callerId,
        body: moderation.text,
        clientMessageId: input.clientMessageId,
        moderated: moderation.masked,
      });
      const dto = toChatMessageDto(message);
      if (!created) return { message: dto, replayed: true };

      const event: ChatRealtimeEvent = { type: "chat_message", message: dto };
      deps.hub.broadcast(shipment.id, event);
      // Best-effort: un fallo de push nunca afecta el envío del mensaje.
      void dispatchPushes(shipment, input.callerId).catch((err) =>
        deps.logger?.warn({ err, event: "chat_push_dispatch_failed", shipmentId: shipment.id }, "Falló el aviso de chat")
      );
      return { message: dto, replayed: false };
    },

    /** Historial paginado, del más reciente al más antiguo. */
    async listMessages(input: {
      shipmentId: string;
      callerId: string;
      callerRoles: UserRole[];
      limit: number;
      cursor?: string;
    }): Promise<ChatMessagesPage> {
      const shipment = await loadShipmentForViewer(input.shipmentId, input.callerId, input.callerRoles);
      const access = accessFor(shipment, input.callerId, input.callerRoles);
      if (access === "closed") {
        throw new ApiError(409, "CHAT_CLOSED", "El chat de este envío ya no está disponible.");
      }
      try {
        const page = await deps.chatRepository.listPage(shipment.id, input.limit, input.cursor);
        return { items: page.items.map(toChatMessageDto), nextCursor: page.nextCursor, access };
      } catch (err) {
        if (err instanceof InvalidChatCursorError) {
          throw new ApiError(400, "VALIDATION_FAILED", "El cursor de paginación es inválido.");
        }
        throw err;
      }
    },

    /** Para la ruta WS: qué puede hacer quien se conecta (ya autorizado como parte del envío). */
    resolveAccess: accessFor,
  };
}

export type ChatService = ReturnType<typeof createChatService>;
