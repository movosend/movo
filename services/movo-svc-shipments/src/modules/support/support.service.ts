import {
  ApiError,
  notificationTriggerCategory,
  renderNotificationTrigger,
  SupportAttachment,
  SupportAttachmentCreateResult,
  SupportConversationItem,
  SupportCreateBody,
  SupportCreateResult,
  SupportUserAttachmentCreateBody,
  SupportUserMessagesPage,
  SupportRealtimeEvent,
  SupportShipmentOptionsPage,
  SupportUserFacingMessage,
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_PUSH_PREVIEW_MAX,
  UserRole,
  verifyAccessToken,
} from "@movo/shared";
import {
  InvalidSupportCursorError,
  SupportConversationRecord,
  SupportMessageRecord,
  SupportRepository,
} from "../../repositories/support-repository";
import { SupportAttachmentClaimError } from "../../repositories/support-attachment-repository";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { NotificationsClient } from "../../adapters/notifications-client";
import { ChatHub } from "../../realtime/chat-hub";
import { hasShipmentAccess } from "../shipments/assert-shipment-access";
import { moderateChatText } from "../../domain/chat-moderation";
import { isUserVisibleKind, toConversationItem, toShipmentOption, toUserFacingMessage, supportRoomKey } from "../../domain/support-rules";
import type { ChatPushBuffer, ChatPushBufferEntry } from "../chat/chat.service";
import { attachmentInvalid, SupportAttachmentsService } from "./support-attachments.service";
import type { SupportAdminFeed } from "../admin-support/support-admin-feed";

type SupportLogger = { warn: (obj: unknown, msg?: string) => void };

/**
 * Ventana de avisos por conversación (ADR-046, mismo criterio que el chat del envío): la primera respuesta del
 * equipo avisa enseguida con su texto; las que llegan seguidas dentro de la ventana se juntan y al cerrarse sale un
 * único resumen si todavía quedan sin leer.
 */
const SUPPORT_PUSH_WINDOW_SECONDS = 30;
/** Tope de conversaciones que devuelve la lista (el usuario tiene pocas; no hace falta paginarla). */
const SUPPORT_LIST_LIMIT = 100;

export interface SupportServiceDeps {
  supportRepository: SupportRepository;
  /** MOVO-321: adjuntos (subida, verificación y URLs firmadas). */
  attachments: SupportAttachmentsService;
  shipmentRepository: ShipmentRepository;
  notificationsClient: NotificationsClient;
  hub: ChatHub;
  /** `SET NX` en Redis: true si esta llamada ganó la marca (primer aviso de la ráfaga). */
  claimNotificationOnce: (key: string, ttlSeconds: number) => Promise<boolean>;
  releaseNotificationClaim: (key: string) => Promise<void>;
  /** Cola (en Redis) de las respuestas sin avisar; se usa la del chat con otra clave de sala. */
  pushBuffer: ChatPushBuffer;
  /** Milisegundos que le quedan a una marca de `claimNotificationOnce` (0 si ya no existe). */
  windowRemainingMs: (key: string) => Promise<number>;
  /** Agenda el resumen de una ráfaga (`setTimeout` por defecto; los tests lo inyectan). */
  schedule?: (run: () => void, delayMs: number) => void;
  logger?: SupportLogger;
  now?: () => Date;
  /** MOVO-322: avisa al panel (Redis Stream, ADR-056) de consultas y mensajes nuevos del usuario. Nunca falla. */
  adminFeed?: SupportAdminFeed;
}

export interface AuthorizedSupportConnection {
  conversation: SupportConversationRecord;
  callerId: string;
  /** `exp` del JWT en ms epoch: la conexión se cierra al llegar a este instante. */
  tokenExpiresAtMs: number;
}

function notFound(): ApiError {
  return new ApiError(404, "SUPPORT_CONVERSATION_NOT_FOUND", "La consulta no existe.");
}

export function createSupportService(deps: SupportServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const repo = deps.supportRepository;

  /**
   * Texto del usuario listo para guardar: recortado, hasta el máximo y con el filtro de lenguaje aplicado. Vacío solo
   * si el mensaje lleva adjuntos (MOVO-321 AC3).
   */
  function prepareUserText(raw: string, hasAttachments: boolean): { text: string; moderated: boolean } {
    const trimmed = raw.trim();
    if ((trimmed.length === 0 && !hasAttachments) || trimmed.length > SUPPORT_MESSAGE_MAX_LENGTH) {
      throw new ApiError(400, "VALIDATION_FAILED", `El mensaje debe tener entre 1 y ${SUPPORT_MESSAGE_MAX_LENGTH} caracteres.`);
    }
    if (trimmed.length === 0) return { text: "", moderated: false };
    const { text, masked } = moderateChatText(trimmed);
    return { text, moderated: masked };
  }

  /** El mensaje tal como lo ve el usuario, con sus adjuntos y URLs recién firmadas (`null` si es una nota). */
  async function userFacing(
    record: SupportMessageRecord,
    viewerId: string,
    lastAgentReadAt: Date | null
  ): Promise<SupportUserFacingMessage | null> {
    if (!isUserVisibleKind(record.kind)) return null;
    const views = await deps.attachments.viewsFor([record]);
    return toUserFacingMessage(record, viewerId, lastAgentReadAt, views.get(record.id) ?? []);
  }


  async function ownedConversation(id: string, userId: string): Promise<SupportConversationRecord> {
    const conversation = await repo.findOwned(id, userId);
    // Ajena e inexistente son lo mismo: no se filtra qué ids existen.
    if (!conversation) throw notFound();
    return conversation;
  }

  async function itemFor(conversation: SupportConversationRecord, userId: string): Promise<SupportConversationItem> {
    const row = await repo.rowFor(conversation, userId);
    return toConversationItem(row.conversation, row.lastMessage, row.unreadCount);
  }

  /**
   * ÚNICO camino de fan-out por WebSocket hacia el usuario. Los mensajes pasan por `toUserFacingMessage`, que
   * descarta las notas internas: ningún evento sale sin pasar por acá.
   */
  async function emitMessage(
    conversation: SupportConversationRecord,
    record: SupportMessageRecord
  ): Promise<SupportUserFacingMessage | null> {
    if (!isUserVisibleKind(record.kind)) return null;
    // El mensaje ya está guardado: si firmar las URLs falla, se difunde sin adjuntos (la app los recupera al pedir
    // `GET /messages`) en vez de fallar el request y cortar lo que sigue (evento de reapertura, estado, push).
    let attachments: SupportAttachment[] = [];
    try {
      attachments = (await deps.attachments.viewsFor([record])).get(record.id) ?? [];
    } catch (err) {
      deps.logger?.warn(
        { err, event: "support_attachment_sign_failed", conversationId: conversation.id, messageId: record.id },
        "No se pudieron firmar los adjuntos del mensaje de soporte; se difunde sin ellos"
      );
    }
    const message = toUserFacingMessage(record, conversation.userId, conversation.lastAgentReadAt, attachments);
    if (!message) return null;
    const event: SupportRealtimeEvent = { type: "support_message", message };
    deps.hub.sendToUser(supportRoomKey(conversation.id), conversation.userId, event);
    return message;
  }

  function emitStatus(conversation: SupportConversationRecord): void {
    const event: SupportRealtimeEvent = { type: "support_status", conversationId: conversation.id, status: conversation.status };
    deps.hub.sendToUser(supportRoomKey(conversation.id), conversation.userId, event);
  }

  function previewOf(body: string): string {
    const text = body.replace(/\s+/g, " ").trim();
    return text.length > SUPPORT_PUSH_PREVIEW_MAX ? `${text.slice(0, SUPPORT_PUSH_PREVIEW_MAX - 1)}…` : text;
  }

  async function sendSupportPush(conversationId: string, userId: string, entry: ChatPushBufferEntry, count: number): Promise<void> {
    // Un `body` vacío (solo imágenes) lo convierte la plantilla en "Te envió una imagen" (MOVO-321 AC6).
    const copy = renderNotificationTrigger("supportMessageReceived", {
      agentName: entry.authorName || undefined,
      messageBody: previewOf(entry.body),
      count,
    });
    await deps.notificationsClient.sendPush({
      userId,
      title: copy.title,
      body: copy.body,
      category: notificationTriggerCategory("supportMessageReceived"),
      data: { type: "support_message", conversationId },
    });
  }

  const pushWindowKey = (conversationId: string, userId: string) => `support-push:${conversationId}:${userId}`;
  const pushFlushKey = (conversationId: string, userId: string) => `support-push-flush:${conversationId}:${userId}`;

  /** Agenda el resumen para cuando CIERRA la ventana vigente (un solo reloj, igual que el chat del envío). */
  async function scheduleFlush(conversationId: string, userId: string): Promise<void> {
    const remainingMs = Math.max(0, await deps.windowRemainingMs(pushWindowKey(conversationId, userId)));
    const claimed = await deps.claimNotificationOnce(pushFlushKey(conversationId, userId), Math.ceil(remainingMs / 1000) + 5);
    if (!claimed) return;
    const schedule = deps.schedule ?? ((run, delayMs) => void setTimeout(run, delayMs).unref());
    schedule(() => void flushSupportPush(conversationId, userId), remainingMs);
  }

  /** Cierre de la ventana: si llegaron más respuestas y siguen sin leer (y la conversación no está abierta), un resumen. */
  async function flushSupportPush(conversationId: string, userId: string): Promise<void> {
    const windowKey = pushWindowKey(conversationId, userId);
    try {
      await deps.releaseNotificationClaim(pushFlushKey(conversationId, userId));
      if (!(await deps.claimNotificationOnce(windowKey, SUPPORT_PUSH_WINDOW_SECONDS))) {
        await scheduleFlush(conversationId, userId);
        return;
      }
      const entries = await deps.pushBuffer.drain(supportRoomKey(conversationId), userId);
      let summary: { entry: ChatPushBufferEntry; count: number } | null = null;
      if (entries.length > 0 && !deps.hub.isUserConnected(supportRoomKey(conversationId), userId)) {
        const unread = await repo.unreadCount(conversationId, userId);
        if (unread > 0) summary = { entry: entries[entries.length - 1], count: Math.min(entries.length, unread) };
      }
      if (!summary) {
        // Nada que avisar: no se deja una ventana abierta que atrase la próxima respuesta.
        await deps.releaseNotificationClaim(windowKey);
        return;
      }
      await sendSupportPush(conversationId, userId, summary.entry, summary.count);
    } catch (err) {
      deps.logger?.warn({ err, event: "support_push_flush_failed", conversationId, userId }, "No se pudo enviar el resumen de soporte");
    }
  }

  async function dispatchPush(conversationId: string, userId: string, entry: ChatPushBufferEntry): Promise<void> {
    const windowKey = pushWindowKey(conversationId, userId);
    if (await deps.claimNotificationOnce(windowKey, SUPPORT_PUSH_WINDOW_SECONDS)) {
      try {
        await sendSupportPush(conversationId, userId, entry, 1);
      } catch (err) {
        await deps.releaseNotificationClaim(windowKey).catch(() => undefined);
        deps.logger?.warn({ err, event: "support_push_failed", conversationId, userId }, "No se pudo notificar la respuesta de soporte");
      }
      return;
    }
    await deps.pushBuffer.add(supportRoomKey(conversationId), userId, entry);
    await scheduleFlush(conversationId, userId);
  }

  return {
    /**
     * Abre una consulta (con o sin envío vinculado) y guarda su primer mensaje. Idempotente por `clientMessageId`:
     * un reintento devuelve lo ya creado (`replayed: true`).
     */
    async createConversation(userId: string, input: SupportCreateBody): Promise<SupportCreateResult & { replayed: boolean }> {
      const attachmentIds = input.attachmentIds ?? [];

      const replay = async (message: SupportMessageRecord) => {
        const conversation = await repo.findById(message.conversationId);
        if (!conversation) throw notFound();
        // Solo es un reintento de la creación si es el primer mensaje de su conversación (se crean con el mismo `now`).
        if (message.createdAt.getTime() !== conversation.createdAt.getTime()) {
          throw new ApiError(400, "VALIDATION_FAILED", "Ese clientMessageId ya se usó en otra consulta.");
        }
        const dto = await userFacing(message, userId, conversation.lastAgentReadAt);
        if (!dto) throw notFound();
        return { conversation: await itemFor(conversation, userId), message: dto, replayed: true };
      };

      const existing = await repo.findUserMessageByClientId(userId, input.clientMessageId);
      if (existing) return replay(existing);

      const { text, moderated } = prepareUserText(input.body, attachmentIds.length > 0);

      let shipmentId: string | null = null;
      if (input.shipmentId) {
        const shipment = await deps.shipmentRepository.findById(input.shipmentId);
        // Sin roles: ni siquiera un admin vincula un envío ajeno a su propia consulta. Inexistente y ajeno dan lo mismo.
        if (!shipment || !hasShipmentAccess(shipment, userId, [])) {
          throw new ApiError(422, "SUPPORT_SHIPMENT_NOT_PARTY", "Solo podés vincular un envío del que sos parte.");
        }
        shipmentId = shipment.id;
      }

      // La consulta todavía no existe: solo sirven adjuntos del usuario sin conversación (`support/pending/…`).
      await deps.attachments.assertUsable({ ids: attachmentIds, uploaderId: userId, uploaderKind: "user", conversationId: null });
      let created;
      try {
        created = await repo.createWithFirstMessage({
          userId,
          topic: input.topic,
          shipmentId,
          body: text,
          moderated,
          clientMessageId: input.clientMessageId,
          attachmentIds,
          now: now(),
        });
      } catch (err) {
        if (!(err instanceof SupportAttachmentClaimError)) throw err;
        // Un reenvío simultáneo puede perder la carrera por los adjuntos en vez de por `clientMessageId`.
        const raced = await repo.findUserMessageByClientId(userId, input.clientMessageId);
        if (raced) return replay(raced);
        throw attachmentInvalid("Alguna imagen no se puede usar en este mensaje.");
      }
      if (!created.created) return replay(created.message);
      await deps.adminFeed?.conversationCreated(created.conversation.id);

      const [message, conversation] = await Promise.all([
        userFacing(created.message, userId, created.conversation.lastAgentReadAt),
        itemFor(created.conversation, userId),
      ]);
      if (!message) throw notFound();
      return { conversation, message, replayed: false };
    },

    async listConversations(userId: string): Promise<{ items: SupportConversationItem[] }> {
      const rows = await repo.listByUser(userId, SUPPORT_LIST_LIMIT);
      return { items: rows.map((r) => toConversationItem(r.conversation, r.lastMessage, r.unreadCount)) };
    },

    /**
     * Historial (sin notas), del más reciente al más antiguo. Abrir la primera página cuenta como recibir lo que había.
     * Cada pedido firma de nuevo las URLs de los adjuntos (así la app renueva una vencida, MOVO-321 AC5).
     */
    async getMessages(input: { userId: string; conversationId: string; limit: number; cursor?: string }): Promise<SupportUserMessagesPage> {
      const conversation = await ownedConversation(input.conversationId, input.userId);
      let page;
      try {
        page = await repo.listUserVisibleMessages(conversation.id, input.limit, input.cursor);
      } catch (err) {
        if (err instanceof InvalidSupportCursorError) throw new ApiError(400, "VALIDATION_FAILED", err.message);
        throw err;
      }
      if (!input.cursor) await repo.markDelivered(conversation.id, input.userId, now());
      const [views, item] = await Promise.all([deps.attachments.viewsFor(page.items), itemFor(conversation, input.userId)]);
      const items = page.items
        .map((m) => toUserFacingMessage(m, input.userId, conversation.lastAgentReadAt, views.get(m.id) ?? []))
        .filter((m): m is SupportUserFacingMessage => m !== null);
      return { items, nextCursor: page.nextCursor, conversation: item };
    },

    /**
     * El usuario escribe. Una `resolved` se reabre (con un mensaje `system`) y una `awaiting_user` vuelve a `open`.
     * Idempotente por `clientMessageId`: el reenvío devuelve el mensaje ya guardado sin volver a difundirlo.
     */
    async sendMessage(input: {
      userId: string;
      conversationId: string;
      body: string;
      clientMessageId: string;
      attachmentIds?: string[];
    }): Promise<{ message: SupportUserFacingMessage; replayed: boolean }> {
      const conversation = await ownedConversation(input.conversationId, input.userId);
      const attachmentIds = input.attachmentIds ?? [];

      const replay = async (record: SupportMessageRecord) => {
        if (record.conversationId !== conversation.id) {
          throw new ApiError(400, "VALIDATION_FAILED", "Ese clientMessageId ya se usó en otra consulta.");
        }
        const dto = await userFacing(record, input.userId, conversation.lastAgentReadAt);
        if (!dto) throw notFound();
        return { message: dto, replayed: true };
      };

      const existing = await repo.findUserMessageByClientId(input.userId, input.clientMessageId);
      if (existing) return replay(existing);

      const { text, moderated } = prepareUserText(input.body, attachmentIds.length > 0);
      await deps.attachments.assertUsable({
        ids: attachmentIds,
        uploaderId: input.userId,
        uploaderKind: "user",
        conversationId: conversation.id,
      });
      let appended;
      try {
        appended = await repo.appendUserMessage({
          conversationId: conversation.id,
          userId: input.userId,
          body: text,
          moderated,
          clientMessageId: input.clientMessageId,
          attachmentIds,
          now: now(),
        });
      } catch (err) {
        if (!(err instanceof SupportAttachmentClaimError)) throw err;
        const raced = await repo.findUserMessageByClientId(input.userId, input.clientMessageId);
        if (raced) return replay(raced);
        throw attachmentInvalid("Alguna imagen no se puede usar en este mensaje.");
      }
      if (!appended.created) return replay(appended.message);

      // Los otros dispositivos del usuario reciben lo mismo que el que escribió (el cliente deduplica por clientMessageId).
      const message = await emitMessage(appended.conversation, appended.message);
      if (!message) throw notFound();
      if (appended.systemMessage) await emitMessage(appended.conversation, appended.systemMessage);
      if (appended.statusChanged) emitStatus(appended.conversation);
      await deps.adminFeed?.messagesAdded(
        appended.conversation.id,
        appended.systemMessage ? [appended.message, appended.systemMessage] : [appended.message]
      );
      return { message, replayed: false };
    },

    /**
     * MOVO-321 AC1: el usuario pide una URL de subida. Con `conversationId` la consulta tiene que ser suya (404 si no,
     * igual que el resto); sin él es una foto de la primera consulta, que todavía no existe.
     */
    async createAttachment(userId: string, input: SupportUserAttachmentCreateBody): Promise<SupportAttachmentCreateResult> {
      const conversationId = input.conversationId ? (await ownedConversation(input.conversationId, userId)).id : null;
      return deps.attachments.create({
        uploaderId: userId,
        uploaderKind: "user",
        conversationId,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
      });
    },

    /**
     * MOVO-324: envíos que el usuario puede vincular a una consulta nueva (los mismos que acepta `createConversation`),
     * en cualquier rol y estado: también se consulta por uno entregado o cancelado.
     */
    async listShipmentOptions(input: { userId: string; limit: number; cursor?: string }): Promise<SupportShipmentOptionsPage> {
      let page;
      try {
        page = await repo.listShipmentOptions(input.userId, input.limit, input.cursor);
      } catch (err) {
        if (err instanceof InvalidSupportCursorError) throw new ApiError(400, "VALIDATION_FAILED", err.message);
        throw err;
      }
      return { items: page.items.map((s) => toShipmentOption(s, input.userId)), nextCursor: page.nextCursor };
    },

    async markRead(userId: string, conversationId: string): Promise<{ readAt: string }> {
      const conversation = await ownedConversation(conversationId, userId);
      const at = now();
      await repo.markRead(conversation.id, userId, at);
      return { readAt: at.toISOString() };
    },

    /**
     * Valida el handshake del WebSocket (JWT del header, como `/track` y el chat del envío). Dueño → ok; un admin que
     * no es el dueño → 403 (4003: los agentes usan el canal del panel); cualquier otro, ajena o inexistente → 404.
     */
    async authorizeConnection(authorizationHeader: string | undefined, conversationId: string): Promise<AuthorizedSupportConnection> {
      if (!authorizationHeader?.startsWith("Bearer ")) {
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Falta el header Authorization.");
      }
      const result = verifyAccessToken(authorizationHeader.slice(7));
      if (result.status === "invalid") throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token inválido o vencido.");
      const { sub: callerId, roles, exp } = result.claims;

      const conversation = await repo.findById(conversationId);
      if (conversation && conversation.userId === callerId) {
        return { conversation, callerId, tokenExpiresAtMs: exp * 1000 };
      }
      if (conversation && roles.includes(UserRole.ADMIN)) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Los agentes usan el canal del panel.");
      }
      throw notFound();
    },

    /** Conectarse cuenta como recibir lo que había. */
    async onConnected(conversationId: string, userId: string): Promise<void> {
      await repo.markDelivered(conversationId, userId, now());
    },

    /**
     * Lo llama el lado del agente (MOVO-322) después de guardar un mensaje: lo difunde al usuario por WebSocket (las
     * notas se descartan) y, si es una respuesta de un agente y el usuario no tiene la conversación abierta, manda la
     * push (ADR-046). Un `system` se difunde pero nunca avisa por push.
     */
    async publishStaffMessage(conversation: SupportConversationRecord, record: SupportMessageRecord): Promise<void> {
      const message = await emitMessage(conversation, record);
      if (!message || record.kind !== "agent") return;
      if (deps.hub.isUserConnected(supportRoomKey(conversation.id), conversation.userId)) return;
      await dispatchPush(conversation.id, conversation.userId, {
        authorId: record.authorId ?? "",
        authorName: record.authorName ?? "",
        body: record.body,
      });
    },

    /** El estado de la conversación cambió (resolvió, reabrió, un agente respondió): se lo cuenta al usuario conectado. */
    publishStatus(conversation: SupportConversationRecord): void {
      emitStatus(conversation);
    },

    /** Un agente abrió la conversación hasta `upTo`: avanza los tildes y se lo avisa al usuario conectado. */
    async publishAgentRead(conversationId: string, userId: string, upTo: Date): Promise<void> {
      await repo.markAgentRead(conversationId, upTo);
      const event: SupportRealtimeEvent = { type: "support_receipt", conversationId, upTo: upTo.toISOString() };
      deps.hub.sendToUser(supportRoomKey(conversationId), userId, event);
    },
  };
}

export type SupportService = ReturnType<typeof createSupportService>;
