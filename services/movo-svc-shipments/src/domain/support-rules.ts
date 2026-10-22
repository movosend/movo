import {
  formatSupportCode,
  supportShipmentCode,
  SupportConversationItem,
  SupportConversationLastMessage,
  SupportDeliveryStatus,
  SupportStatus,
  SupportUserFacingMessage,
} from "@movo/shared";

/**
 * MOVO-320 (ADR-051): reglas puras de las conversaciones de soporte del lado del usuario. Sin acceso a datos
 * para poder probarlas aisladas; el repositorio y el servicio las aplican.
 */

export type SupportMessageKindValue = "user" | "agent" | "note" | "system";

/** Los `kind` que ve el usuario. Lista blanca a propósito: un `kind` nuevo queda oculto hasta que se decida mostrarlo. */
export const USER_VISIBLE_MESSAGE_KINDS = ["user", "agent", "system"] as const;

export interface SupportMessageFacts {
  id: string;
  conversationId: string;
  kind: SupportMessageKindValue;
  authorId: string | null;
  authorName: string | null;
  body: string;
  clientMessageId: string | null;
  moderated: boolean;
  createdAt: Date;
}

export interface SupportConversationFacts {
  id: string;
  codeNumber: number;
  userId: string;
  topic: SupportConversationItem["topic"];
  status: SupportStatus;
  shipmentId: string | null;
  lastMessageAt: Date;
  lastAgentReadAt: Date | null;
}

/**
 * Qué pasa con el estado cuando el usuario escribe: una `resolved` se reabre (y se deja un mensaje `system`),
 * una `awaiting_user` vuelve a `open` porque ahora le toca al equipo; una `open` queda como está.
 */
export function statusAfterUserMessage(status: SupportStatus): { status: SupportStatus; reopened: boolean } {
  if (status === "resolved") return { status: "open", reopened: true };
  if (status === "awaiting_user") return { status: "open", reopened: false };
  return { status, reopened: false };
}

/** ✓ enviado / ✓✓ leído: lo leyó un agente si abrió la conversación después de que se escribió. */
export function userDeliveryStatus(messageCreatedAt: Date, lastAgentReadAt: Date | null): SupportDeliveryStatus {
  return lastAgentReadAt !== null && lastAgentReadAt.getTime() >= messageCreatedAt.getTime() ? "read" : "sent";
}

/**
 * ÚNICO punto por donde un mensaje llega al usuario (API, WebSocket y push): una nota interna devuelve `null`
 * y quien llama la descarta. No hay otro camino que arme un `SupportUserFacingMessage`.
 */
export function toUserFacingMessage(
  record: SupportMessageFacts,
  viewerId: string,
  lastAgentReadAt: Date | null
): SupportUserFacingMessage | null {
  if (record.kind === "note") return null;
  const own = record.kind === "user" && record.authorId === viewerId;
  return {
    id: record.id,
    conversationId: record.conversationId,
    kind: record.kind,
    authorName: record.kind === "agent" ? record.authorName : null,
    body: record.body,
    clientMessageId: record.clientMessageId,
    moderated: record.kind === "user" ? record.moderated : false,
    deliveryStatus: own ? userDeliveryStatus(record.createdAt, lastAgentReadAt) : null,
    attachments: [],
    createdAt: record.createdAt.toISOString(),
  };
}

/** Último mensaje para la lista: nunca una nota ni un evento `system`. */
export function toLastMessage(record: SupportMessageFacts | null): SupportConversationLastMessage | null {
  if (!record || (record.kind !== "user" && record.kind !== "agent")) return null;
  return {
    from: record.kind,
    authorName: record.kind === "agent" ? record.authorName : null,
    body: record.body,
    hasAttachments: false,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toConversationItem(
  conversation: SupportConversationFacts,
  lastMessage: SupportMessageFacts | null,
  unreadCount: number
): SupportConversationItem {
  return {
    id: conversation.id,
    code: formatSupportCode(conversation.codeNumber),
    topic: conversation.topic,
    status: conversation.status,
    shipment: conversation.shipmentId
      ? { id: conversation.shipmentId, code: supportShipmentCode(conversation.shipmentId) }
      : null,
    lastMessage: toLastMessage(lastMessage),
    unreadCount,
    lastActivityAt: conversation.lastMessageAt.toISOString(),
  };
}

/** Clave de sala del `ChatHub`: distinta de la del envío (un UUID pelado) para no mezclar tráfico. */
export function supportRoomKey(conversationId: string): string {
  return `support:${conversationId}`;
}
