import {
  ApiError,
  ChatAccess,
  ChatDeliveryStatus,
  ChatListItem,
  ChatMessage,
  ChatMessagesPage,
  ChatParticipant,
  ChatParticipantRole,
  ChatRealtimeEvent,
  CHAT_MESSAGE_MAX_LENGTH,
  notificationTriggerCategory,
  renderNotificationTrigger,
  UserRole,
} from "@movo/shared";
import {
  ChatMessageRecord,
  ChatRepository,
  ChatShipmentRow,
  InvalidChatCursorError,
} from "../../repositories/chat-repository";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { UsersClient } from "../../adapters/users-client";
import { NotificationsClient } from "../../adapters/notifications-client";
import { ChatHub } from "../../realtime/chat-hub";
import { assertShipmentAccess } from "../shipments/assert-shipment-access";
import { safeBlockRelatedUserIds } from "../../utils/block-relations";
import { CHAT_LISTABLE_STATUSES, ChatShipmentFacts, isChatArchived, resolveChatAccess } from "../../domain/chat-window";
import { ChatReceiptState, computeDeliveryStatus } from "../../domain/chat-receipts";
import { moderateChatText } from "../../domain/chat-moderation";
import { Shipment } from "../../models/shipment";

type ChatLogger = { warn: (obj: unknown, msg?: string) => void };

/**
 * Ventana de avisos por destinatario y conversación (MOVO-301, al estilo WhatsApp): el primer mensaje avisa enseguida
 * con su texto; los que llegan seguidos dentro de la ventana no mandan una push cada uno, se juntan y al cerrarse la
 * ventana sale un único resumen ("3 mensajes nuevos · …") si todavía quedan sin leer.
 */
const CHAT_PUSH_WINDOW_SECONDS = 30;
/** Largo máximo del texto en la push: el sistema igual lo corta, pero no hace falta mandar un mensaje de 2.000 caracteres. */
const CHAT_PUSH_PREVIEW_MAX = 140;
/** Tope de chats que devuelve la lista. */
const CHAT_LIST_LIMIT = 50;
const UNKNOWN_USER_NAME = "Usuario de Movo";

/** Un mensaje que no avisó por estar dentro de la ventana; se resume al cerrarse. */
export interface ChatPushBufferEntry {
  authorId: string;
  authorName: string;
  body: string;
}

/** Cola (en Redis) de los mensajes sin avisar de una conversación para un destinatario. */
export interface ChatPushBuffer {
  add(shipmentId: string, userId: string, entry: ChatPushBufferEntry): Promise<void>;
  /** Devuelve y vacía la cola, en orden de llegada. */
  drain(shipmentId: string, userId: string): Promise<ChatPushBufferEntry[]>;
}

export interface ChatServiceDeps {
  shipmentRepository: ShipmentRepository;
  chatRepository: ChatRepository;
  usersClient: UsersClient;
  notificationsClient: NotificationsClient;
  hub: ChatHub;
  /** `SET NX` en Redis: true si esta llamada ganó la marca (primer aviso de la ráfaga). */
  claimNotificationOnce: (key: string, ttlSeconds: number) => Promise<boolean>;
  releaseNotificationClaim: (key: string) => Promise<void>;
  pushBuffer: ChatPushBuffer;
  /** Milisegundos que le quedan a una marca de `claimNotificationOnce` (0 si ya no existe). */
  windowRemainingMs: (key: string) => Promise<number>;
  /** Agenda el resumen de una ráfaga (`setTimeout` por defecto; los tests lo inyectan). */
  schedule?: (run: () => void, delayMs: number) => void;
  logger?: ChatLogger;
  now?: () => Date;
}

/** Lo que cambia de un mensaje según quién lo mira: si está oculto (bloqueo) y sus tildes. */
interface ViewOptions {
  hidden?: boolean;
  deliveryStatus?: ChatDeliveryStatus | null;
}

export function toChatMessageDto(record: ChatMessageRecord, view: ViewOptions = {}): ChatMessage {
  const hidden = view.hidden ?? false;
  return {
    id: record.id,
    shipmentId: record.shipmentId,
    authorId: record.authorId,
    authorName: record.authorName,
    body: hidden ? "" : record.body,
    clientMessageId: record.clientMessageId,
    moderated: hidden ? false : record.moderated,
    hidden,
    deliveryStatus: view.deliveryStatus ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Primera parte de una dirección ("Av. Colón 1234, Córdoba" → "Av. Colón 1234"). */
function shortAddress(address: string): string {
  return address.split(",")[0]?.trim() || address;
}

/** Los integrantes del hilo, sin repetir si una misma persona cumple dos roles. */
function chatParties(shipment: Pick<Shipment, "senderId" | "receiverId" | "carrierId">): string[] {
  return [...new Set([shipment.senderId, shipment.carrierId, shipment.receiverId].filter((id): id is string => Boolean(id)))];
}

export function createChatService(deps: ChatServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function loadShipmentForViewer(shipmentId: string, callerId: string, callerRoles: UserRole[]): Promise<Shipment> {
    const shipment = await deps.shipmentRepository.findById(shipmentId);
    if (!shipment) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
    assertShipmentAccess(shipment, callerId, callerRoles, "No tenés permiso para ver el chat de este envío.");
    return shipment;
  }

  function accessFor(shipment: ChatShipmentFacts, viewerId: string, viewerRoles: UserRole[]): ChatAccess {
    return resolveChatAccess({ shipment, viewerId, viewerRoles });
  }

  /** Quienes tienen un bloqueo con `userId` (ADR-026, simétrico). Falla abierto: sin `svc-users`, nada se oculta. */
  async function blockedWith(userId: string): Promise<Set<string>> {
    return new Set(await safeBlockRelatedUserIds(deps.usersClient, userId, deps.logger));
  }

  /** Los demás integrantes que cuentan para los tildes de un mensaje de `authorId`. */
  async function receiptOthers(shipment: Shipment, authorId: string, blocked: Set<string>): Promise<ChatReceiptState[]> {
    const states = await deps.chatRepository.listReceiptStates(shipment.id);
    return chatParties(shipment)
      .filter((id) => id !== authorId && !blocked.has(id))
      .map((userId) => states.find((s) => s.userId === userId) ?? { userId, lastDeliveredAt: null, lastReadAt: null });
  }

  /** Avisa a los demás integrantes conectados que `actingUserId` recibió o leyó hasta `upTo`. */
  async function emitReceipt(
    shipment: Shipment,
    actingUserId: string,
    status: "delivered" | "read",
    upTo: Date
  ): Promise<void> {
    const connected = deps.hub.connectedUserIds(shipment.id).filter((id) => id !== actingUserId);
    if (connected.length === 0) return;
    const blocked = await blockedWith(actingUserId);
    const event: ChatRealtimeEvent = {
      type: "chat_receipt",
      shipmentId: shipment.id,
      userId: actingUserId,
      status,
      upTo: upTo.toISOString(),
    };
    for (const userId of connected) {
      if (!blocked.has(userId)) deps.hub.sendToUser(shipment.id, userId, event);
    }
  }

  async function resolveAuthorName(authorId: string, shipmentId: string): Promise<string | null> {
    try {
      const profile = await deps.usersClient.findPublicProfile(authorId, authorId);
      return profile ? firstName(profile.fullName) : null;
    } catch (err) {
      deps.logger?.warn({ err, event: "chat_author_name_failed", shipmentId }, "No se pudo resolver el nombre del autor");
      return null;
    }
  }

  /** "Emisor" / "Transportista" / "Receptor" según quién escribió; un ex integrante no lleva rol. */
  function roleLabelOf(shipment: Shipment, authorId: string): string | undefined {
    if (authorId === shipment.senderId) return "Emisor";
    if (authorId === shipment.carrierId) return "Transportista";
    if (authorId === shipment.receiverId) return "Receptor";
    return undefined;
  }

  function previewOf(body: string): string {
    const text = body.replace(/\s+/g, " ").trim();
    return text.length > CHAT_PUSH_PREVIEW_MAX ? `${text.slice(0, CHAT_PUSH_PREVIEW_MAX - 1)}…` : text;
  }

  async function sendChatPush(
    shipment: Shipment,
    userId: string,
    entry: ChatPushBufferEntry,
    count: number
  ): Promise<void> {
    const copy = renderNotificationTrigger("chatMessageReceived", {
      authorName: entry.authorName,
      roleLabel: roleLabelOf(shipment, entry.authorId),
      messageBody: previewOf(entry.body),
      count,
    });
    await deps.notificationsClient.sendPush({
      userId,
      title: copy.title,
      body: copy.body,
      category: notificationTriggerCategory("chatMessageReceived"),
      data: { type: "chat_message", shipmentId: shipment.id },
    });
  }

  const pushWindowKey = (shipmentId: string, userId: string) => `chat-push:${shipmentId}:${userId}`;
  const pushFlushKey = (shipmentId: string, userId: string) => `chat-push-flush:${shipmentId}:${userId}`;

  /**
   * Agenda el resumen para cuando CIERRA la ventana vigente (lo que le falta de vida, no una ventana nueva desde
   * este mensaje): así la ventana y el resumen comparten un solo reloj y un mensaje posterior nunca sale antes que
   * uno anterior. Una sola vez por ventana: la marca de agendado dura lo que falta más un margen.
   */
  async function scheduleFlush(shipmentId: string, userId: string): Promise<void> {
    const remainingMs = Math.max(0, await deps.windowRemainingMs(pushWindowKey(shipmentId, userId)));
    const claimed = await deps.claimNotificationOnce(pushFlushKey(shipmentId, userId), Math.ceil(remainingMs / 1000) + 5);
    if (!claimed) return;
    const schedule = deps.schedule ?? ((run, delayMs) => void setTimeout(run, delayMs).unref());
    schedule(() => void flushChatPush(shipmentId, userId), remainingMs);
  }

  /**
   * Cierre de la ventana: si en el medio llegaron más mensajes y siguen sin leer, un único resumen. Se relee el envío
   * (el rol o el acceso pudieron cambiar en esos segundos por una reasignación o una transferencia de receptor) y se
   * vuelven a filtrar los autores bloqueados (ADR-026): el bloqueo pudo ser posterior a que el mensaje entrara a la
   * cola. Si el destinatario ya abrió la conversación no se avisa de algo que ya vio.
   */
  async function flushChatPush(shipmentId: string, userId: string): Promise<void> {
    const windowKey = pushWindowKey(shipmentId, userId);
    try {
      // Desde acá, lo que llegue agenda su propio resumen.
      await deps.releaseNotificationClaim(pushFlushKey(shipmentId, userId));
      // Si otro mensaje ya abrió una ventana (llegó justo al vencer la anterior), el resumen espera a que cierre.
      if (!(await deps.claimNotificationOnce(windowKey, CHAT_PUSH_WINDOW_SECONDS))) {
        await scheduleFlush(shipmentId, userId);
        return;
      }
      const entries = await deps.pushBuffer.drain(shipmentId, userId);
      const shipment = await deps.shipmentRepository.findById(shipmentId);
      let summary: { entry: ChatPushBufferEntry; count: number } | null = null;
      if (entries.length > 0 && shipment && chatParties(shipment).includes(userId) && accessFor(shipment, userId, []) !== "closed") {
        const blocked = await blockedWith(userId);
        const visible = entries.filter((e) => !blocked.has(e.authorId));
        const unread = (await deps.chatRepository.unreadCounts(userId, [shipmentId], [...blocked])).get(shipmentId) ?? 0;
        if (visible.length > 0 && unread > 0) summary = { entry: visible[visible.length - 1], count: Math.min(visible.length, unread) };
      }
      if (!summary || !shipment) {
        // Nada que avisar: no se deja una ventana abierta que atrase el próximo mensaje.
        await deps.releaseNotificationClaim(windowKey);
        return;
      }
      await sendChatPush(shipment, userId, summary.entry, summary.count);
    } catch (err) {
      deps.logger?.warn({ err, event: "chat_push_flush_failed", shipmentId, userId }, "No se pudo enviar el resumen de chat");
    }
  }

  async function dispatchPush(shipment: Shipment, userId: string, entry: ChatPushBufferEntry): Promise<void> {
    const windowKey = pushWindowKey(shipment.id, userId);
    if (await deps.claimNotificationOnce(windowKey, CHAT_PUSH_WINDOW_SECONDS)) {
      try {
        await sendChatPush(shipment, userId, entry, 1);
      } catch (err) {
        await deps.releaseNotificationClaim(windowKey).catch(() => undefined);
        deps.logger?.warn(
          { err, event: "chat_push_failed", shipmentId: shipment.id, userId },
          "No se pudo notificar el mensaje de chat"
        );
      }
      return;
    }
    // Dentro de la ventana: se junta y un único resumen sale cuando cierra.
    await deps.pushBuffer.add(shipment.id, userId, entry);
    await scheduleFlush(shipment.id, userId);
  }

  /** Marca lo recibido por `userId` (si es parte del envío) y se lo avisa a los demás. */
  async function touchDelivered(shipment: Shipment, userId: string): Promise<void> {
    if (!chatParties(shipment).includes(userId)) return;
    const at = now();
    await deps.chatRepository.markDelivered(shipment.id, userId, at);
    await emitReceipt(shipment, userId, "delivered", at);
  }

  type ParticipantLookup = Map<string, Promise<Pick<ChatParticipant, "firstName" | "fullName" | "photoUrl">>>;

  /** Nombre y foto de `userId`; si `svc-users` no responde, un integrante sin datos (el chat no se cae por eso). */
  function lookupParticipant(userId: string, viewerId: string, cache: ParticipantLookup) {
    let found = cache.get(userId);
    if (!found) {
      found = (async () => {
        try {
          const profile = await deps.usersClient.findPublicProfile(userId, viewerId);
          if (profile) return { firstName: firstName(profile.fullName), fullName: profile.fullName, photoUrl: profile.photoUrl };
        } catch (err) {
          deps.logger?.warn({ err, event: "chat_participant_lookup_failed", userId }, "No se pudo resolver un integrante del chat");
        }
        return { firstName: UNKNOWN_USER_NAME, fullName: UNKNOWN_USER_NAME, photoUrl: null };
      })();
      cache.set(userId, found);
    }
    return found;
  }

  /** Emisor, transportista y receptor (sin repetir a nadie), con nombre y foto, en ese orden. */
  async function resolveParticipants(
    shipment: Pick<Shipment, "senderId" | "carrierId" | "receiverId">,
    viewerId: string,
    cache: ParticipantLookup
  ): Promise<ChatParticipant[]> {
    const roles: Array<{ userId: string | null; role: ChatParticipantRole }> = [
      { userId: shipment.senderId, role: "sender" },
      { userId: shipment.carrierId, role: "carrier" },
      { userId: shipment.receiverId, role: "receiver" },
    ];
    const seen = new Set<string>();
    const unique = roles.filter((r): r is { userId: string; role: ChatParticipantRole } => {
      if (!r.userId || seen.has(r.userId)) return false;
      seen.add(r.userId);
      return true;
    });
    return Promise.all(
      unique.map(async ({ userId, role }) => ({ userId, role, ...(await lookupParticipant(userId, viewerId, cache)) }))
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

      // Un reintento de un mensaje que ya se guardó devuelve ese mensaje aunque el chat haya cambiado de estado
      // en el medio (se perdió la respuesta y el envío se entregó o canceló): si no, el cliente lo marcaría como
      // fallido pese a que sí salió. Va antes del chequeo de acceso por eso.
      const existing = await deps.chatRepository.findByClientMessageId(shipment.id, input.callerId, input.clientMessageId);
      if (existing) {
        const blocked = await blockedWith(input.callerId);
        const deliveryStatus = computeDeliveryStatus(existing.createdAt, await receiptOthers(shipment, input.callerId, blocked));
        return { message: toChatMessageDto(existing, { deliveryStatus }), replayed: true };
      }

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

      // Se guarda y se difunde el texto ya enmascarado: nadie más llega a ver la palabra.
      const moderation = moderateChatText(body);
      const authorName = await resolveAuthorName(input.callerId, shipment.id);
      const { message, created } = await deps.chatRepository.create({
        shipmentId: shipment.id,
        authorId: input.callerId,
        authorName,
        body: moderation.text,
        clientMessageId: input.clientMessageId,
        moderated: moderation.masked,
      });

      // ADR-026: quien tiene un bloqueo con el autor no recibe el contenido, pero el chat sigue para los demás.
      const blocked = await blockedWith(input.callerId);
      const recipients = chatParties(shipment).filter((id) => id !== input.callerId);

      if (created) {
        // Los destinatarios con el chat abierto lo reciben ya: quedan como "entregado".
        const delivered: string[] = [];
        // También a quienes solo miran (el admin y el receptor original, ADR-038): están conectados con acceso de
        // lectura y, si no, verían el hilo desactualizado hasta recargar. No cuentan como "entregado" para los tildes.
        // Solo esos dos: un transportista anterior con el socket todavía vivo ya no es parte y no debe leer la
        // conversación nueva (cada asignación arranca limpia).
        const watchers = deps.hub
          .connectedUserIds(shipment.id)
          .filter(
            (id) =>
              id !== input.callerId &&
              !recipients.includes(id) &&
              (id === shipment.formerReceiverId || deps.hub.isAdminConnected(shipment.id, id))
          );
        for (const userId of [...recipients, ...watchers]) {
          const hidden = blocked.has(userId);
          if (!deps.hub.isUserConnected(shipment.id, userId)) continue;
          deps.hub.sendToUser(shipment.id, userId, {
            type: "chat_message",
            message: toChatMessageDto(message, { hidden }),
          } satisfies ChatRealtimeEvent);
          if (!hidden && recipients.includes(userId)) delivered.push(userId);
        }
        await Promise.all(delivered.map((userId) => deps.chatRepository.markDelivered(shipment.id, userId, message.createdAt)));
        for (const userId of delivered) {
          deps.hub.sendToUser(shipment.id, input.callerId, {
            type: "chat_receipt",
            shipmentId: shipment.id,
            userId,
            status: "delivered",
            upTo: message.createdAt.toISOString(),
          } satisfies ChatRealtimeEvent);
        }

        // Best-effort: un fallo de push nunca afecta el envío del mensaje.
        const toNotify = recipients.filter((id) => !blocked.has(id) && !deps.hub.isUserConnected(shipment.id, id));
        void Promise.all(toNotify.map((id) =>
            dispatchPush(shipment, id, { authorId: input.callerId, authorName: authorName ?? UNKNOWN_USER_NAME, body: message.body })
          )).catch((err) =>
          deps.logger?.warn({ err, event: "chat_push_dispatch_failed", shipmentId: shipment.id }, "Falló el aviso de chat")
        );
      }

      const deliveryStatus = computeDeliveryStatus(message.createdAt, await receiptOthers(shipment, input.callerId, blocked));
      const dto = toChatMessageDto(message, { deliveryStatus });
      if (created) {
        // Los otros dispositivos del autor ven su mensaje con los tildes que ya tiene.
        deps.hub.sendToUser(shipment.id, input.callerId, { type: "chat_message", message: dto } satisfies ChatRealtimeEvent);
      }
      return { message: dto, replayed: !created };
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

      const isAdminOnly = input.callerRoles.includes(UserRole.ADMIN) && !chatParties(shipment).includes(input.callerId);
      let page;
      try {
        // Cada asignación arranca una conversación limpia: quien entra al chat no lee lo hablado con un transportista
        // anterior. El admin sí lo ve todo (el historial es evidencia de disputa).
        page = await deps.chatRepository.listPage(shipment.id, input.limit, input.cursor, isAdminOnly ? null : shipment.chatStartedAt);
      } catch (err) {
        if (err instanceof InvalidChatCursorError) {
          throw new ApiError(400, "VALIDATION_FAILED", "El cursor de paginación es inválido.");
        }
        throw err;
      }

      // El admin ve todo (evidencia de disputa); las demás personas no ven lo de quien tienen bloqueado.
      const blocked = isAdminOnly ? new Set<string>() : await blockedWith(input.callerId);
      const others = page.items.some((m) => m.authorId === input.callerId)
        ? await receiptOthers(shipment, input.callerId, blocked)
        : [];

      const items = page.items.map((record) => {
        const own = record.authorId === input.callerId;
        return toChatMessageDto(record, {
          hidden: !own && blocked.has(record.authorId),
          deliveryStatus: own ? computeDeliveryStatus(record.createdAt, others) : null,
        });
      });

      // Abrir el chat cuenta como recibir lo que había.
      if (!input.cursor) await touchDelivered(shipment, input.callerId);

      return {
        items,
        nextCursor: page.nextCursor,
        access,
        archived: isChatArchived(shipment, now()),
        reportedByMe: await deps.chatRepository.hasReport(shipment.id, input.callerId),
      };
    },

    /** Quien mira el chat leyó todo hasta ahora: avisa a los demás (tildes azules) y baja su contador. */
    async markRead(input: { shipmentId: string; callerId: string; callerRoles: UserRole[] }): Promise<{ readAt: string }> {
      const shipment = await loadShipmentForViewer(input.shipmentId, input.callerId, input.callerRoles);
      if (accessFor(shipment, input.callerId, input.callerRoles) === "closed") {
        throw new ApiError(409, "CHAT_CLOSED", "El chat de este envío ya no está disponible.");
      }
      const at = now();
      // Quien solo mira (el receptor original o el admin) también baja su contador de no leídos: la lista le muestra
      // el envío y, si no, su badge solo crece. Pero su lectura no avisa a los demás ni mueve sus tildes.
      await deps.chatRepository.markRead(shipment.id, input.callerId, at);
      if (chatParties(shipment).includes(input.callerId)) {
        await emitReceipt(shipment, input.callerId, "read", at);
      }
      return { readAt: at.toISOString() };
    },

    /** Los integrantes del hilo, para el encabezado ("Ana, Diego y Luis") y los avatares. */
    async getParticipants(input: { shipmentId: string; callerId: string; callerRoles: UserRole[] }): Promise<ChatParticipant[]> {
      const shipment = await loadShipmentForViewer(input.shipmentId, input.callerId, input.callerRoles);
      if (accessFor(shipment, input.callerId, input.callerRoles) === "closed") {
        throw new ApiError(409, "CHAT_CLOSED", "El chat de este envío ya no está disponible.");
      }
      return resolveParticipants(shipment, input.callerId, new Map());
    },

    /** "Reportar conversación": una por persona y envío; la revisa el equipo de Movo. */
    async reportConversation(input: { shipmentId: string; callerId: string; callerRoles: UserRole[] }): Promise<{ created: boolean }> {
      const shipment = await loadShipmentForViewer(input.shipmentId, input.callerId, input.callerRoles);
      if (!chatParties(shipment).includes(input.callerId)) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Solo las partes del envío pueden reportar la conversación.");
      }
      if (accessFor(shipment, input.callerId, input.callerRoles) === "closed") {
        throw new ApiError(409, "CHAT_CLOSED", "El chat de este envío ya no está disponible.");
      }
      const result = await deps.chatRepository.createReport(shipment.id, input.callerId);
      if (result.created) {
        deps.logger?.warn(
          { event: "chat_conversation_reported", shipmentId: shipment.id, reporterId: input.callerId },
          "Conversación de chat reportada"
        );
      }
      return result;
    },

    /** La lista "Chats": uno por envío con transportista, con último mensaje y no leídos. */
    async listChats(input: { callerId: string }): Promise<ChatListItem[]> {
      const rows: ChatShipmentRow[] = await deps.chatRepository.listShipmentsForUser(
        input.callerId,
        CHAT_LISTABLE_STATUSES,
        CHAT_LIST_LIMIT
      );
      const visible = rows
        .map((row) => ({ row, access: accessFor(row, input.callerId, []) }))
        .filter((r): r is { row: ChatShipmentRow; access: "open" | "read_only" } => r.access !== "closed");
      if (visible.length === 0) return [];

      const ids = visible.map((v) => v.row.id);
      const blocked = await blockedWith(input.callerId);
      // Un mismo transportista o receptor suele repetirse en varios envíos: se consulta una sola vez por persona.
      const lookup: ParticipantLookup = new Map();
      const [last, unread, participants] = await Promise.all([
        deps.chatRepository.lastMessages(ids),
        deps.chatRepository.unreadCounts(input.callerId, ids, [...blocked]),
        Promise.all(visible.map(({ row }) => resolveParticipants(row, input.callerId, lookup))),
      ]);

      return visible
        .map(({ row, access }, index): ChatListItem => {
          const lastRecord = last.get(row.id);
          const lastMessage = lastRecord
            ? {
                authorId: lastRecord.authorId,
                authorName: lastRecord.authorName,
                body: lastRecord.authorId !== input.callerId && blocked.has(lastRecord.authorId) ? "" : lastRecord.body,
                hidden: lastRecord.authorId !== input.callerId && blocked.has(lastRecord.authorId),
                createdAt: lastRecord.createdAt.toISOString(),
              }
            : null;
          return {
            shipmentId: row.id,
            status: row.status,
            route: `${shortAddress(row.pickupAddress)} → ${shortAddress(row.deliveryAddress)}`,
            access,
            archived: isChatArchived(row, now()),
            unreadCount: unread.get(row.id) ?? 0,
            lastMessage,
            lastActivityAt: (lastRecord?.createdAt ?? row.lastStatusChangedAt ?? now()).toISOString(),
            participants: participants[index],
          };
        })
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    },

    /** Para la ruta WS: qué puede hacer quien se conecta (ya autorizado como parte del envío). */
    resolveAccess: accessFor,

    /** Conectarse al chat cuenta como recibir lo que había. */
    onConnected: touchDelivered,
  };
}

export type ChatService = ReturnType<typeof createChatService>;
