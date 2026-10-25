import type {
  SupportAttachment,
  SupportCounts,
  SupportPatchBody,
  SupportPriority,
  SupportShipmentRef,
  SupportStatus,
  SupportTag,
  SupportTopic,
  SupportUserHistoryItem,
} from "./admin-support";

/**
 * MOVO-322: contrato INTERNO entre `svc-admin` y `svc-shipments` (`/internal/admin/support/*`, solo red Docker).
 * `svc-shipments` es dueño del modelo y solo conoce ids; `svc-admin` completa los nombres (`svc-users`) y arma los
 * tipos del panel de `admin-support.ts`. Nada de acá llega al panel tal cual.
 */

export type SupportInternalMessageKind = "user" | "agent" | "note" | "system" | "event";

export interface SupportInternalLastMessage {
  from: "user" | "agent";
  authorId: string | null;
  body: string;
  hasAttachments: boolean;
  createdAt: string;
}

/** Fila de la bandeja sin nombres: `userId` y `assignedTo` los resuelve `svc-admin`. */
export interface SupportInternalRow {
  id: string;
  code: string;
  userId: string;
  topic: SupportTopic;
  priority: SupportPriority;
  status: SupportStatus;
  assignedTo: string | null;
  unread: number;
  lastMessage: SupportInternalLastMessage | null;
  waitMinutes: number;
  shipment: SupportShipmentRef | null;
  tags: SupportTag[];
  lastActivityAt: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SupportInternalListPage {
  items: SupportInternalRow[];
  nextCursor: string | null;
}

/**
 * Mensaje con todos los `kind`. `event` es un evento del equipo (asignación, prioridad, resolución...): el panel lo
 * muestra como `system` y el usuario nunca lo ve. En `event`, `authorId`/`authorName` son el actor (nombre completo).
 */
export interface SupportInternalMessage {
  id: string;
  conversationId: string;
  kind: SupportInternalMessageKind;
  authorId: string | null;
  authorName: string | null;
  body: string;
  clientMessageId: string | null;
  attachments: SupportAttachment[];
  createdAt: string;
}

export interface SupportInternalMessagesPage {
  items: SupportInternalMessage[];
  nextCursor: string | null;
}

/** Filtros de la bandeja ya resueltos por `svc-admin`: `assignee=me` llega como el id del admin. */
export interface SupportInternalListQuery {
  status: SupportStatus;
  /** Id de un agente o `none`. */
  assignee?: string;
  q?: string;
  /** Usuarios cuyo nombre coincide con `q` (los busca `svc-admin` en `svc-users`). */
  userIds?: string[];
  cursor?: string;
}

/** `byOwner.mine` es del admin que pide (`viewerId`). */
export type SupportInternalCountsQuery = Omit<SupportInternalListQuery, "cursor"> & { viewerId: string };
export type SupportInternalCounts = SupportCounts;

/** Quién actúa: `svc-admin` lo resuelve con `svc-users` (el panel no lo manda). */
export interface SupportInternalActor {
  actorId: string;
  /** Nombre completo: los eventos van en tercera persona ("Tomás Ferreyra tomó la conversación"). */
  actorFullName: string;
}

export interface SupportInternalSendBody extends SupportInternalActor {
  /** Nombre de pila: es lo que ve el usuario como autor de la respuesta. */
  actorFirstName: string;
  body: string;
  clientMessageId: string;
  internal?: boolean;
  attachmentIds?: string[];
}

export interface SupportInternalSendResult {
  message: SupportInternalMessage;
  conversation: SupportInternalRow;
}

export interface SupportInternalPatchBody extends SupportPatchBody, SupportInternalActor {
  /** Nombre completo del agente al que se asigna (si `assignedTo` es otro agente). */
  assigneeFullName?: string;
}

export interface SupportInternalAttachmentBody extends SupportInternalActor {
  contentType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

export interface SupportInternalAgentLoad {
  agentId: string;
  activeCount: number;
}

export interface SupportInternalParties {
  userId: string;
}

export interface SupportInternalUserConversations {
  items: SupportUserHistoryItem[];
}

/**
 * Entrada del Redis Stream `support:events` (ADR-056): la escribe `svc-shipments` en cada cambio y la lee `svc-admin`
 * para el WebSocket y `GET /admin/support/events`. Viaja sin nombres; `counts_changed` no trae contadores porque
 * `byOwner.mine` depende de quién mira: `svc-admin` los calcula por admin.
 */
export type SupportStreamEvent =
  | { type: "conversation_created"; conversation: SupportInternalRow }
  | { type: "support_message"; conversation: SupportInternalRow; message: SupportInternalMessage }
  | { type: "conversation_updated"; conversation: SupportInternalRow }
  | { type: "counts_changed" };

/** Clave del stream y campo del payload (JSON) en cada entrada. */
export const SUPPORT_EVENTS_STREAM_KEY = "support:events";
export const SUPPORT_EVENTS_STREAM_FIELD = "data";
/** Aproximado (`MAXLEN ~`): alcanza para varios minutos de actividad; un cursor más viejo da `reset`. */
export const SUPPORT_EVENTS_STREAM_MAXLEN = 2000;
