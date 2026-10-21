import type { SupportAttachment, SupportAttachmentType, SupportStatus, SupportTopic } from "./admin-support";

/**
 * Soporte, lado del usuario (MOVO-324): contrato propuesto para `/api/v1/support/*` de `svc-shipments`
 * (MOVO-320 y MOVO-321). El lado del agente vive en `admin-support.ts`; estos tipos tienen otro prefijo
 * (`SupportThread*`, `SupportConversationItem`) para no pisar `SupportMessage` ni `SupportMessagesPage` de ahí.
 * Las fechas viajan en ISO-8601 UTC. Ver `docs/support/README.md`.
 */

/** Rol del usuario en un envío vinculable a la consulta. */
export type SupportShipmentRole = "sender" | "carrier" | "receiver";

/** Lo que ve el usuario sobre sus mensajes: ✓ enviado, ✓✓ leído por el equipo (hay un solo "otro lado"). */
export type SupportDeliveryStatus = "sent" | "read";

export interface SupportConversationShipment {
  id: string;
  /** `MOVO-48213`. */
  code: string;
}

/** Último mensaje visible para el usuario: nunca una nota interna ni un evento `system`. */
export interface SupportConversationLastMessage {
  from: "user" | "agent";
  /** Nombre de pila del agente; `null` si escribió el usuario. */
  authorName: string | null;
  /** Vacío si el mensaje es solo de imágenes (`hasAttachments`). */
  body: string;
  hasAttachments: boolean;
  createdAt: string;
}

/** Una consulta del usuario (fila de "Mis consultas" y encabezado de la conversación). */
export interface SupportConversationItem {
  id: string;
  /** `SOP-1042`. */
  code: string;
  topic: SupportTopic;
  status: SupportStatus;
  shipment: SupportConversationShipment | null;
  lastMessage: SupportConversationLastMessage | null;
  unreadCount: number;
  lastActivityAt: string;
}

/**
 * Mensaje de la conversación tal como lo ve el usuario. Las notas internas no existen para el cliente
 * (ni por API, ni por WebSocket, ni por push).
 */
export interface SupportThreadMessage {
  id: string;
  conversationId: string;
  kind: "user" | "agent" | "system";
  /** Nombre de pila del agente ("Lucía"); `null` en los del usuario y en `system`. */
  authorName: string | null;
  /** En `system` lo arma el servidor en tercera persona ("Lucía Ferreyra tomó la conversación"). */
  body: string;
  /** Id generado por el cliente: reenviarlo no duplica el mensaje. Vacío en los del equipo. */
  clientMessageId: string;
  /** El filtro de lenguaje tapó alguna palabra de `body` (solo en mensajes del usuario). */
  moderated: boolean;
  /** Solo en los mensajes propios; `null` en el resto. */
  deliveryStatus: SupportDeliveryStatus | null;
  attachments: SupportAttachment[];
  createdAt: string;
}

/** `GET /support/conversations/:id/messages`: más recientes primero. Lleva la consulta para el encabezado. */
export interface SupportThreadPage {
  items: SupportThreadMessage[];
  nextCursor: string | null;
  conversation: SupportConversationItem;
}

export interface SupportListResponse {
  items: SupportConversationItem[];
}

/** `POST /support/conversations`. Idempotente por `clientMessageId`. */
export interface SupportCreateBody {
  topic: SupportTopic;
  body: string;
  clientMessageId: string;
  shipmentId?: string;
  attachmentIds?: string[];
}

export interface SupportCreateResult {
  conversation: SupportConversationItem;
  message: SupportThreadMessage;
}

/** `POST /support/conversations/:id/messages`. Un mensaje puede ir solo con adjuntos (`body` vacío). */
export interface SupportSendUserBody {
  body: string;
  clientMessageId: string;
  attachmentIds?: string[];
}

/** `POST /support/attachments`. Sin `conversationId` (primera consulta) el objeto queda en un prefijo privado "pendiente". */
export interface SupportUserAttachmentCreateBody {
  contentType: SupportAttachmentType;
  sizeBytes: number;
  conversationId?: string;
}

/** Un envío de los que el usuario es parte (emisor, transportista o receptor), para vincularlo a una consulta. */
export interface SupportShipmentOption {
  id: string;
  /** `MOVO-48213`. */
  code: string;
  status: string;
  /** "Palermo → Quilmes". */
  route: string;
  role: SupportShipmentRole;
  createdAt: string;
}

/** `GET /support/shipments`: más recientes primero, páginas por cursor. */
export interface SupportShipmentOptionsPage {
  items: SupportShipmentOption[];
  nextCursor: string | null;
}

/** Evento que el servidor empuja por `GET /support/conversations/:id` (WebSocket). */
export type SupportRealtimeEvent =
  | { type: "connected" }
  | { type: "support_message"; message: SupportThreadMessage }
  | { type: "support_status"; conversationId: string; status: SupportStatus }
  /** Un agente leyó hasta `upTo`: la app actualiza los tildes de sus mensajes. */
  | { type: "support_receipt"; conversationId: string; upTo: string };

/** Códigos de cierre del WebSocket de soporte (mismos que el chat del envío). */
export const SUPPORT_WS_CLOSE = {
  TOKEN_EXPIRED: 4001,
  FORBIDDEN: 4003,
  NOT_FOUND: 4004,
} as const;
