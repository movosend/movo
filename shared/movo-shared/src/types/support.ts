import type {
  SupportAttachment,
  SupportShipmentRef,
  SupportStatus,
  SupportTopic,
} from "./admin-support";

/**
 * Contrato de soporte del lado del USUARIO (MOVO-320, consumido por MOVO-324 en `movo-mobile`):
 * `/api/v1/support/*`. El lado del agente (bandeja del panel) vive en `admin-support.ts`.
 *
 * Regla de oro: el usuario NUNCA recibe una nota interna. Por eso `kind` no incluye `note` y
 * ninguno de estos tipos tiene un campo para ella: ni en la API, ni en el WebSocket, ni en la push.
 *
 * Las fechas viajan en ISO-8601 UTC.
 */

/** Estado de entrega de un mensaje propio: el usuario solo tiene un "otro lado" (Movo). */
export type SupportDeliveryStatus = "sent" | "read";

/**
 * Mensaje tal como lo ve el usuario. Se llama distinto de `SupportUserMessage` (admin-support.ts),
 * que es el "mensaje del usuario" visto desde el panel.
 */
export interface SupportUserFacingMessage {
  id: string;
  conversationId: string;
  kind: "user" | "agent" | "system";
  /** Nombre de pila del agente ("Lucía"); `null` en los propios y en los `system`. */
  authorName: string | null;
  /** En `system` el texto va en tercera persona, armado por el servidor. Puede ser vacío si hay adjuntos. */
  body: string;
  /** Id generado por el cliente: reenviarlo no duplica el mensaje. Vacío en `system`. */
  clientMessageId: string | null;
  /** El filtro de lenguaje tapó alguna palabra de `body` con asteriscos (solo mensajes del usuario). */
  moderated: boolean;
  /** Solo en los mensajes propios; `null` en el resto. */
  deliveryStatus: SupportDeliveryStatus | null;
  attachments: SupportAttachment[];
  createdAt: string;
}

/** Último mensaje visible de la conversación: nunca una nota ni un evento `system`. */
export interface SupportConversationLastMessage {
  from: "user" | "agent";
  authorName: string | null;
  body: string;
  /** Con `body` vacío y `hasAttachments`, la app muestra "Foto". */
  hasAttachments: boolean;
  createdAt: string;
}

/** Fila de `GET /support/conversations` y encabezado de la conversación. */
export interface SupportConversationItem {
  id: string;
  /** `SOP-1042`. */
  code: string;
  topic: SupportTopic;
  status: SupportStatus;
  shipment: SupportShipmentRef | null;
  lastMessage: SupportConversationLastMessage | null;
  unreadCount: number;
  lastActivityAt: string;
}

export interface SupportListResponse {
  items: SupportConversationItem[];
}

/** Página del historial, del más reciente al más antiguo. */
export interface SupportMessagesPage {
  items: SupportUserFacingMessage[];
  nextCursor: string | null;
  /** Para el encabezado: la conversación también se abre desde la push, sin pasar por la lista. */
  conversation: SupportConversationItem;
}

/** `POST /support/conversations`. Sin `shipmentId` es una consulta libre. */
export interface SupportCreateBody {
  topic: SupportTopic;
  body: string;
  clientMessageId: string;
  shipmentId?: string;
  /** Reservado para MOVO-321: hasta entonces un valor no vacío responde 422 `SUPPORT_ATTACHMENT_INVALID`. */
  attachmentIds?: string[];
}

/** 201 al crear, 200 si `clientMessageId` ya existía (idempotente). */
export interface SupportCreateResult {
  conversation: SupportConversationItem;
  message: SupportUserFacingMessage;
}

/** `POST /support/conversations/:id/messages`. */
export interface SupportSendUserBody {
  body: string;
  clientMessageId: string;
  /** Reservado para MOVO-321 (ver `SupportCreateBody`). */
  attachmentIds?: string[];
}

/** `POST /support/conversations/:id/read`. */
export interface SupportReadResult {
  readAt: string;
}

/**
 * Evento que el servidor empuja por el WebSocket de la conversación. Además, al conectar manda un
 * frame `{ type: "connected" }` (como el chat del envío): la app refresca la primera página.
 */
export type SupportRealtimeEvent =
  | { type: "support_message"; message: SupportUserFacingMessage }
  | { type: "support_status"; conversationId: string; status: SupportStatus }
  /** Un agente leyó hasta `upTo`: la app actualiza los tildes de sus mensajes. */
  | { type: "support_receipt"; conversationId: string; upTo: string };

/** Frame que el servidor manda apenas acepta la conexión. */
export interface SupportRealtimeConnected {
  type: "connected";
  conversationId: string;
}

/** Códigos de cierre del WebSocket de soporte (los mismos que el chat del envío y `/track`). */
export const SUPPORT_WS_CLOSE = {
  /** Token inválido o vencido: la app renueva y reconecta. */
  TOKEN: 4001,
  /** Sin permiso (terminal). */
  FORBIDDEN: 4003,
  /** La conversación no existe o no es del usuario (terminal). */
  NOT_FOUND: 4004,
} as const;

/** Texto del evento `system` cuando el usuario escribe sobre una consulta resuelta. */
export const SUPPORT_REOPENED_MESSAGE = "Se reabrió la conversación";

/** Largo máximo del preview de la push de soporte (como `CHAT_PUSH_PREVIEW_MAX`). */
export const SUPPORT_PUSH_PREVIEW_MAX = 140;

/**
 * Código de display de un envío en soporte (`MOVO-48213`): los últimos 5 dígitos del UUID, igual que
 * `activeShipmentDisplayCode` del mobile (sin el `#`). No existe un correlativo persistido en el backend.
 */
export function supportShipmentCode(shipmentId: string): string {
  const digits = shipmentId.replace(/\D/g, "");
  return `MOVO-${digits.slice(-5).padStart(5, "0")}`;
}

/** `SOP-1042` a partir del número de secuencia (mínimo 4 dígitos, ver `SUPPORT_CODE_RE`). */
export function formatSupportCode(codeNumber: number): string {
  return `SOP-${String(codeNumber).padStart(4, "0")}`;
}
