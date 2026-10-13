/**
 * MOVO-26 (ADR-040): chat entre las partes de un envío (emisor, receptor, transportista).
 * Un único hilo por envío; se envía por HTTP y se recibe por WebSocket (mismo molde que
 * la ingesta de posiciones, ADR-024).
 */

/** Largo máximo de un mensaje, después de `trim`. El mínimo es 1. */
export const CHAT_MESSAGE_MAX_LENGTH = 1000;

/** El chat sigue disponible hasta estas horas después de la entrega (AC1 de MOVO-26). */
export const CHAT_POST_DELIVERY_WINDOW_HOURS = 24;

/** Tope de ítems por página del historial. */
export const CHAT_PAGE_MAX_LIMIT = 100;

/**
 * Lo que puede hacer quien mira el chat de un envío:
 * - `open`: lee y escribe.
 * - `read_only`: lee pero no escribe (receptor original tras transferir la recepción,
 *   envío en disputa, o bloqueo con otra de las partes).
 * - `closed`: ya no tiene acceso al hilo (fuera de la ventana o envío cancelado). El admin
 *   nunca queda en `closed`.
 */
export type ChatAccess = "open" | "read_only" | "closed";

/** Wire contract de un mensaje. Fechas en ISO 8601. */
export interface ChatMessage {
  id: string;
  shipmentId: string;
  authorId: string;
  body: string;
  /** Id generado por el cliente: reenviarlo no duplica el mensaje. */
  clientMessageId: string;
  createdAt: string;
}

/** Página del historial, del más reciente al más antiguo. */
export interface ChatMessagesPage {
  items: ChatMessage[];
  nextCursor: string | null;
  access: Exclude<ChatAccess, "closed">;
}

/** Mensaje que el servidor empuja por el WebSocket del chat. */
export interface ChatRealtimeEvent {
  type: "chat_message";
  message: ChatMessage;
}
