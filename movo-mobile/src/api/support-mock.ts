import { ApiError } from "@movo/shared/dist/errors/api-error";
import { SUPPORT_ATTACHMENT_MAX_PER_MESSAGE } from "@movo/shared/dist/types/admin-support";
import type { SupportAttachmentCreateResult } from "@movo/shared/dist/types/admin-support";
import type {
  SupportConversationItem,
  SupportCreateBody,
  SupportCreateResult,
  SupportListResponse,
  SupportSendUserBody,
  SupportShipmentOption,
  SupportShipmentOptionsPage,
  SupportUserFacingMessage,
  SupportMessagesPage,
  SupportUserAttachmentCreateBody,
} from "@movo/shared/dist/types/support";

/**
 * MOVO-324: implementación en memoria del contrato de soporte del usuario (`EXPO_PUBLIC_SUPPORT_MOCK=1`).
 * Referencia de las reglas que tiene que cumplir el backend (MOVO-320/321): idempotencia por
 * `clientMessageId`, reapertura al escribir sobre una resuelta (con su evento `system`), filtro de lenguaje,
 * envío vinculado solo si el usuario es parte, adjuntos de un solo uso, y que las notas internas nunca existen
 * del lado del usuario. No abre WebSocket: lo nuevo se ve al volver a pedir la lista o el historial.
 */

/** Latencia simulada; los tests la bajan a 0. */
export const supportMockConfig = { latencyMs: 250 };
const PAGE_SIZE = 30;
const OFFENSIVE = /\b(mierda|boludo|pelotudo|hijo de puta)\b/gi;

interface MockConversation {
  item: SupportConversationItem;
  messages: SupportUserFacingMessage[];
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

function message(
  conversationId: string,
  kind: SupportUserFacingMessage["kind"],
  body: string,
  createdAt: string,
  extra: Partial<SupportUserFacingMessage> = {},
): SupportUserFacingMessage {
  return {
    id: nextId("msg"),
    conversationId,
    kind,
    authorName: kind === "agent" ? "Lucía" : null,
    body,
    clientMessageId: kind === "user" ? nextId("seed") : "",
    moderated: false,
    deliveryStatus: kind === "user" ? "read" : null,
    attachments: [],
    createdAt,
    ...extra,
  };
}

function seedStore(): { conversations: MockConversation[]; shipments: SupportShipmentOption[] } {
  const c1 = "conv-1048";
  const c2 = "conv-1042";
  const c3 = "conv-1021";
  const conversations: MockConversation[] = [
    {
      item: {
        id: c1,
        code: "SOP-1048",
        topic: "payments",
        status: "awaiting_user",
        shipment: null,
        unreadCount: 2,
        lastActivityAt: minutesAgo(30),
        lastMessage: { from: "agent", authorName: "Lucía", body: "¿Me pasás el comprobante de la transferencia?", hasAttachments: false, createdAt: minutesAgo(30) },
      },
      messages: [
        message(c1, "user", "Me cobraron dos veces el envío de ayer.", minutesAgo(90)),
        message(c1, "agent", "¿Me pasás el comprobante de la transferencia?", minutesAgo(30)),
      ],
    },
    {
      item: {
        id: c2,
        code: "SOP-1042",
        topic: "shipment",
        status: "open",
        shipment: { id: "11111-48213", code: "MOVO-48213" },
        unreadCount: 0,
        lastActivityAt: minutesAgo(1_500),
        lastMessage: { from: "user", authorName: null, body: "Sí, hay portero de 8 a 20.", hasAttachments: false, createdAt: minutesAgo(1_500) },
      },
      messages: [
        message(c2, "user", "La caja llegó abierta y falta uno de los dos libros.", minutesAgo(1_700)),
        message(c2, "system", "Lucía Ferreyra tomó la conversación", minutesAgo(1_680)),
        message(c2, "agent", "Hola, gracias por las fotos. Ya hablé con el transportista.", minutesAgo(1_600)),
        message(c2, "user", "Sí, hay portero de 8 a 20.", minutesAgo(1_500)),
      ],
    },
    {
      item: {
        id: c3,
        code: "SOP-1021",
        topic: "account",
        status: "resolved",
        shipment: null,
        unreadCount: 0,
        lastActivityAt: minutesAgo(14_000),
        lastMessage: { from: "agent", authorName: "Tomás", body: "Listo, ya actualizamos tu email.", hasAttachments: false, createdAt: minutesAgo(14_000) },
      },
      messages: [
        message(c3, "user", "Quiero cambiar el email de mi cuenta.", minutesAgo(14_100)),
        message(c3, "agent", "Listo, ya actualizamos tu email.", minutesAgo(14_000), { authorName: "Tomás" }),
        message(c3, "system", "Tomás Ruiz marcó la consulta como resuelta", minutesAgo(13_990)),
      ],
    },
  ];
  const shipments: SupportShipmentOption[] = [
    { id: "11111-48213", code: "MOVO-48213", status: "in_transit", route: "Palermo → Quilmes", role: "sender", createdAt: minutesAgo(3_000) },
    { id: "11111-48176", code: "MOVO-48176", status: "delivered", route: "Güemes → Cofico", role: "carrier", createdAt: minutesAgo(9_000) },
    { id: "11111-48102", code: "MOVO-48102", status: "delivered", route: "Nueva Córdoba → Alta Córdoba", role: "receiver", createdAt: minutesAgo(20_000) },
    { id: "11111-47990", code: "MOVO-47990", status: "cancelled", route: "San Telmo → Avellaneda", role: "sender", createdAt: minutesAgo(30_000) },
  ];
  return { conversations, shipments };
}

let store = seedStore();
/** Adjuntos pedidos y todavía sin asociar a un mensaje (de un solo uso). */
let pendingAttachments = new Set<string>();

/** Solo para tests: vuelve al estado inicial. */
export function resetSupportMock(): void {
  counter = 0;
  store = seedStore();
  pendingAttachments = new Set();
}

const delay = <T>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), supportMockConfig.latencyMs));

function find(conversationId: string): MockConversation {
  const found = store.conversations.find((c) => c.item.id === conversationId);
  if (!found) throw new ApiError(404, "SUPPORT_CONVERSATION_NOT_FOUND", "Conversación no encontrada");
  return found;
}

function moderate(body: string): { body: string; moderated: boolean } {
  const masked = body.replace(OFFENSIVE, (word) => "*".repeat(word.length));
  return { body: masked, moderated: masked !== body };
}

function consumeAttachments(ids: string[] | undefined) {
  const attachmentIds = ids ?? [];
  if (attachmentIds.length > SUPPORT_ATTACHMENT_MAX_PER_MESSAGE) {
    throw new ApiError(422, "SUPPORT_ATTACHMENT_INVALID", "Demasiados adjuntos");
  }
  for (const id of attachmentIds) {
    if (!pendingAttachments.has(id)) throw new ApiError(422, "SUPPORT_ATTACHMENT_INVALID", "Adjunto inválido o ya usado");
  }
  attachmentIds.forEach((id) => pendingAttachments.delete(id));
  return attachmentIds.map((id) => ({ id, contentType: "image/jpeg" as const, url: `https://picsum.photos/seed/${id}/600/600` }));
}

function touch(conv: MockConversation, msg: SupportUserFacingMessage) {
  conv.item.lastActivityAt = msg.createdAt;
  if (msg.kind === "user" || msg.kind === "agent") {
    conv.item.lastMessage = {
      from: msg.kind,
      authorName: msg.authorName,
      body: msg.body,
      hasAttachments: msg.attachments.length > 0,
      createdAt: msg.createdAt,
    };
  }
}

function appendUserMessage(conv: MockConversation, body: string, clientMessageId: string, attachmentIds?: string[]): SupportUserFacingMessage {
  const existing = conv.messages.find((m) => m.kind === "user" && m.clientMessageId === clientMessageId);
  if (existing) return existing;
  if (!body.trim() && !(attachmentIds && attachmentIds.length > 0)) {
    throw new ApiError(400, "VALIDATION_FAILED", "El mensaje está vacío");
  }
  const attachments = consumeAttachments(attachmentIds);
  if (conv.item.status === "resolved") {
    const reopened = message(conv.item.id, "system", "Se reabrió la conversación", new Date().toISOString());
    conv.messages.push(reopened);
    conv.item.status = "open";
  } else if (conv.item.status === "awaiting_user") {
    conv.item.status = "open";
  }
  const moderated = moderate(body);
  const created = message(conv.item.id, "user", moderated.body, new Date().toISOString(), {
    clientMessageId,
    moderated: moderated.moderated,
    deliveryStatus: "sent",
    attachments,
  });
  conv.messages.push(created);
  touch(conv, created);
  return created;
}

export const supportMock = {
  list(): Promise<SupportListResponse> {
    const items = store.conversations.map((c) => ({ ...c.item })).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    return delay({ items });
  },

  create(body: SupportCreateBody): Promise<SupportCreateResult> {
    const duplicate = store.conversations.find((c) => c.messages.some((m) => m.kind === "user" && m.clientMessageId === body.clientMessageId));
    if (duplicate) {
      const first = duplicate.messages.find((m) => m.clientMessageId === body.clientMessageId)!;
      return delay({ conversation: { ...duplicate.item }, message: first });
    }
    const shipment = body.shipmentId ? store.shipments.find((s) => s.id === body.shipmentId) : undefined;
    if (body.shipmentId && !shipment) {
      return Promise.reject(new ApiError(422, "SUPPORT_SHIPMENT_NOT_PARTY", "No sos parte de ese envío"));
    }
    const id = nextId("conv");
    const conv: MockConversation = {
      item: {
        id,
        code: `SOP-${1050 + store.conversations.length}`,
        topic: body.topic,
        status: "open",
        shipment: shipment ? { id: shipment.id, code: shipment.code } : null,
        unreadCount: 0,
        lastActivityAt: new Date().toISOString(),
        lastMessage: null,
      },
      messages: [],
    };
    try {
      const created = appendUserMessage(conv, body.body, body.clientMessageId, body.attachmentIds);
      store.conversations.unshift(conv);
      return delay({ conversation: { ...conv.item }, message: created });
    } catch (error) {
      return Promise.reject(error);
    }
  },

  listMessages(conversationId: string, params: { cursor?: string; limit?: number } = {}): Promise<SupportMessagesPage> {
    try {
      const conv = find(conversationId);
      const newestFirst = [...conv.messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const limit = params.limit ?? PAGE_SIZE;
      const start = params.cursor ? Number(params.cursor) : 0;
      const items = newestFirst.slice(start, start + limit);
      const nextCursor = start + limit < newestFirst.length ? String(start + limit) : null;
      return delay({ items, nextCursor, conversation: { ...conv.item } });
    } catch (error) {
      return Promise.reject(error);
    }
  },

  sendMessage(conversationId: string, body: SupportSendUserBody): Promise<SupportUserFacingMessage> {
    try {
      return delay(appendUserMessage(find(conversationId), body.body, body.clientMessageId, body.attachmentIds));
    } catch (error) {
      return Promise.reject(error);
    }
  },

  markRead(conversationId: string): Promise<{ readAt: string }> {
    try {
      find(conversationId).item.unreadCount = 0;
      return delay({ readAt: new Date().toISOString() });
    } catch (error) {
      return Promise.reject(error);
    }
  },

  listShipments(params: { cursor?: string; limit?: number } = {}): Promise<SupportShipmentOptionsPage> {
    const limit = params.limit ?? 20;
    const start = params.cursor ? Number(params.cursor) : 0;
    const items = store.shipments.slice(start, start + limit);
    return delay({ items, nextCursor: start + limit < store.shipments.length ? String(start + limit) : null });
  },

  presignAttachment(body: SupportUserAttachmentCreateBody): Promise<SupportAttachmentCreateResult> {
    if (body.contentType !== "image/jpeg" && body.contentType !== "image/png" && body.contentType !== "image/webp") {
      return Promise.reject(new ApiError(422, "SUPPORT_ATTACHMENT_INVALID", "Tipo de imagen inválido"));
    }
    const attachmentId = nextId("att");
    pendingAttachments.add(attachmentId);
    return delay({ attachmentId, uploadUrl: "mock://upload", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
  },

  async uploadAttachment(): Promise<{ attachmentId: string }> {
    const presigned = await supportMock.presignAttachment({ contentType: "image/jpeg", sizeBytes: 1 });
    return { attachmentId: presigned.attachmentId };
  },
};
