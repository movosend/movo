import { ShipmentStatus } from "./shipment";

/**
 * MOVO-26 (ADR-023): chat entre las partes de un envío (emisor, receptor, transportista).
 * Un único hilo por envío; se envía por HTTP y se recibe por WebSocket (mismo molde que la
 * ingesta de posiciones, ADR-020).
 */

/** Largo máximo de un mensaje, después de `trim`. El mínimo es 1. */
export const CHAT_MESSAGE_MAX_LENGTH = 1000;

/** Pasadas estas horas desde la entrega, el chat se archiva (sigue legible, solo lectura). */
export const CHAT_POST_DELIVERY_WINDOW_HOURS = 24;

/** Tope de ítems por página del historial. */
export const CHAT_PAGE_MAX_LIMIT = 100;

/**
 * Lo que puede hacer quien mira el chat de un envío:
 * - `open`: lee y escribe (hay transportista asignado y el paquete no se entregó).
 * - `read_only`: lee pero no escribe (envío entregado, en disputa, o receptor original).
 * - `closed`: ya no tiene acceso (envío cancelado o sin transportista). El admin nunca queda acá.
 */
export type ChatAccess = "open" | "read_only" | "closed";

/** Lo que ve quien escribió un mensaje: ✓ enviado, ✓✓ entregado a todos, ✓✓ leído por todos. */
export type ChatDeliveryStatus = "sent" | "delivered" | "read";

/** Wire contract de un mensaje. Fechas en ISO 8601. */
export interface ChatMessage {
  id: string;
  shipmentId: string;
  authorId: string;
  /** Primer nombre del autor al momento de escribir (para "Diego: …" sin otra consulta). */
  authorName: string | null;
  /**
   * Vacío si `hidden`. Las palabras ofensivas ya vienen tapadas con asteriscos (`moderated`).
   */
  body: string;
  /** Id generado por el cliente: reenviarlo no duplica el mensaje. */
  clientMessageId: string;
  /** El filtro de lenguaje tapó alguna palabra de `body` con asteriscos. */
  moderated: boolean;
  /**
   * El autor tiene un bloqueo con quien mira (DD-026): el contenido no se entrega y el cliente
   * muestra "Mensaje de un usuario bloqueado".
   */
  hidden: boolean;
  /** Solo en los mensajes propios; `null` en los ajenos. */
  deliveryStatus: ChatDeliveryStatus | null;
  createdAt: string;
}

/** Página del historial, del más reciente al más antiguo. */
export interface ChatMessagesPage {
  items: ChatMessage[];
  nextCursor: string | null;
  access: Exclude<ChatAccess, "closed">;
  /** Entregado hace más de 24 h: el chat se archivó (sigue legible). */
  archived: boolean;
  /** Quien mira ya reportó esta conversación. */
  reportedByMe: boolean;
}

export type ChatParticipantRole = "sender" | "carrier" | "receiver";

/** Los tres integrantes del hilo, para el encabezado y los avatares. */
export interface ChatParticipant {
  userId: string;
  role: ChatParticipantRole;
  /** Primer nombre. */
  firstName: string;
  fullName: string;
  photoUrl: string | null;
}

export interface ChatParticipantsResponse {
  participants: ChatParticipant[];
}

/** Un chat en la lista "Chats": uno por envío con transportista asignado. */
export interface ChatListItem {
  shipmentId: string;
  status: ShipmentStatus;
  /** Retiro → entrega, solo la primera parte de cada dirección. */
  route: string;
  access: Exclude<ChatAccess, "closed">;
  archived: boolean;
  unreadCount: number;
  lastMessage: Pick<ChatMessage, "authorId" | "authorName" | "body" | "hidden" | "createdAt"> | null;
  /** Hora del último mensaje; si no hubo, la del último cambio de estado. */
  lastActivityAt: string;
  /** Emisor, transportista y receptor, para los avatares de la fila (mismo contenido que `GET .../chat/participants`). */
  participants: ChatParticipant[];
}

export interface ChatListResponse {
  items: ChatListItem[];
}

/** Evento que el servidor empuja por el WebSocket del chat. */
export type ChatRealtimeEvent =
  | { type: "chat_message"; message: ChatMessage }
  /**
   * Alguien recibió o leyó los mensajes hasta `upTo`: el cliente actualiza los tildes de sus
   * mensajes propios. Para recalcular "entregado/leído por todos" guarda el último valor por usuario.
   */
  | { type: "chat_receipt"; shipmentId: string; userId: string; status: "delivered" | "read"; upTo: string }
  /**
   * MOVO-340: cambiaron los integrantes del hilo (se completó una transferencia de receptor). El
   * cliente vuelve a pedir los integrantes y su acceso: el receptor nuevo escribe, el original
   * queda en solo lectura sin que se cierre el socket.
   */
  | { type: "chat_participants_changed"; shipmentId: string };

/**
 * Aviso que ve quien escribió un mensaje al que el filtro le tapó palabras (`moderated: true`).
 * Vive acá para que todos los clientes muestren el mismo texto.
 */
export const CHAT_MODERATION_WARNING =
  "Cuidá tu lenguaje. En Movo nos respetamos entre todos, por eso tapamos con asteriscos las palabras ofensivas de tu mensaje.";
