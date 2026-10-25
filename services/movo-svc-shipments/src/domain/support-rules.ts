import {
  formatSupportCode,
  supportShipmentCode,
  SupportConversationItem,
  SupportConversationLastMessage,
  SupportDeliveryStatus,
  SupportAttachment,
  SupportShipmentOption,
  SupportShipmentRole,
  SupportStatus,
  SupportUserFacingMessage,
} from "@movo/shared";
import { shortAddress } from "../utils/short-address";

/**
 * MOVO-320 (ADR-051): reglas puras de las conversaciones de soporte del lado del usuario. Sin acceso a datos
 * para poder probarlas aisladas; el repositorio y el servicio las aplican.
 */

export type SupportMessageKindValue = "user" | "agent" | "note" | "system" | "event";

/** Los `kind` que ve el usuario. Lista blanca a propósito: un `kind` nuevo queda oculto hasta que se decida mostrarlo. */
export const USER_VISIBLE_MESSAGE_KINDS = ["user", "agent", "system"] as const;

/** Si el usuario ve ese `kind`. Nunca una nota ni un evento del equipo (MOVO-322). */
export function isUserVisibleKind(kind: SupportMessageKindValue): kind is (typeof USER_VISIBLE_MESSAGE_KINDS)[number] {
  return (USER_VISIBLE_MESSAGE_KINDS as readonly string[]).includes(kind);
}

export interface SupportMessageFacts {
  id: string;
  conversationId: string;
  kind: SupportMessageKindValue;
  authorId: string | null;
  authorName: string | null;
  body: string;
  clientMessageId: string | null;
  moderated: boolean;
  /** MOVO-321: adjuntos asociados al crearlo (no cambia). */
  attachmentCount: number;
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
  lastAgentReadAt: Date | null,
  /** MOVO-321: ya con su URL firmada; quien llama los resuelve (las reglas puras no tocan el storage). */
  attachments: SupportAttachment[] = []
): SupportUserFacingMessage | null {
  if (!isUserVisibleKind(record.kind)) return null;
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
    attachments,
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
    hasAttachments: record.attachmentCount > 0,
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

/** Lo mínimo de un envío para ofrecerlo en el selector de "Nueva consulta" (MOVO-324). */
export interface SupportShipmentOptionFacts {
  id: string;
  senderId: string;
  receiverId: string;
  carrierId: string | null;
  status: string;
  pickupAddress: string;
  pickupCity: string | null;
  deliveryAddress: string;
  deliveryCity: string | null;
  createdAt: Date;
}

/**
 * Rol del usuario en el envío. El transportista primero (un emisor no puede llevar su propio envío, pero el orden
 * deja la regla explícita); quien transfirió la recepción figura como receptor.
 */
export function supportShipmentRole(shipment: SupportShipmentOptionFacts, userId: string): SupportShipmentRole {
  if (shipment.carrierId === userId) return "carrier";
  if (shipment.senderId === userId) return "sender";
  return "receiver";
}

/** "Nueva Córdoba → Alta Córdoba": la ciudad resuelta o, si todavía no hay, el primer tramo de la dirección. */
export function supportShipmentRoute(shipment: SupportShipmentOptionFacts): string {
  const pickup = shipment.pickupCity ?? shortAddress(shipment.pickupAddress);
  const delivery = shipment.deliveryCity ?? shortAddress(shipment.deliveryAddress);
  return `${pickup} → ${delivery}`;
}

export function toShipmentOption(shipment: SupportShipmentOptionFacts, userId: string): SupportShipmentOption {
  return {
    id: shipment.id,
    code: supportShipmentCode(shipment.id),
    status: shipment.status,
    route: supportShipmentRoute(shipment),
    role: supportShipmentRole(shipment, userId),
    createdAt: shipment.createdAt.toISOString(),
  };
}

/** Clave de sala del `ChatHub`: distinta de la del envío (un UUID pelado) para no mezclar tráfico. */
export function supportRoomKey(conversationId: string): string {
  return `support:${conversationId}`;
}
