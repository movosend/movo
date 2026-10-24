/**
 * Contratos de la bandeja de soporte del panel (MOVO-323). Los define MOVO-323 (pantallas) y los
 * implementan MOVO-322 (`svc-admin` `/admin/support/*` + endpoints internos de `svc-shipments`) y
 * MOVO-321 (adjuntos): ver la sección "Contrato propuesto por MOVO-323" de esos tickets y
 * `docs/support/README.md`. El panel solo habla con `svc-admin` (decisión 6 de MOVO-286).
 *
 * Los enums de dominio se referencian como unión de literales para que el panel no arrastre el
 * valor al bundle. Las fechas viajan en ISO-8601 UTC.
 */

/** Estado de la consulta: abierta (le toca al equipo), esperando al usuario, o resuelta. */
export type SupportStatus = "open" | "awaiting_user" | "resolved";
export type SupportPriority = "urgent" | "high" | "normal" | "low";
export type SupportTopic = "shipment" | "payments" | "account" | "carrier" | "security";
/** Rol con el que el usuario escribió (lo fija la app al abrir la consulta); no es un campo de cuenta. */
export type SupportUserRole = "sender" | "carrier" | "receiver";

export const SUPPORT_STATUSES: readonly SupportStatus[] = ["open", "awaiting_user", "resolved"];
export const SUPPORT_PRIORITIES: readonly SupportPriority[] = ["urgent", "high", "normal", "low"];
export const SUPPORT_TOPICS: readonly SupportTopic[] = [
  "shipment",
  "payments",
  "account",
  "carrier",
  "security",
];

/** Lista cerrada de etiquetas (MOVO-322 AC6); las etiquetas no generan evento `system`. */
export const SUPPORT_TAGS = [
  "Disputa",
  "Daño",
  "Cobro",
  "Reembolso",
  "KYC",
  "Bug de la app",
  "Onboarding",
  "Escalado",
  "VIP",
] as const;
export type SupportTag = (typeof SUPPORT_TAGS)[number];

/** Desde cuántos minutos esperando se marca en rojo en la lista. */
export const SUPPORT_WAIT_ALERT_MINUTES = 15;
/** Largo máximo de un mensaje o nota. */
export const SUPPORT_MESSAGE_MAX_LENGTH = 2000;
export const SUPPORT_LIST_PAGE_SIZE = 30;
export const SUPPORT_MESSAGES_PAGE_SIZE = 50;
/** `SOP-NNNN` (4 dígitos como mínimo). */
export const SUPPORT_CODE_RE = /^SOP-\d{4,}$/;

/** Adjuntos (MOVO-321): solo imágenes, 5 MB, hasta 4 por mensaje. */
export const SUPPORT_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type SupportAttachmentType = (typeof SUPPORT_ATTACHMENT_TYPES)[number];
export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPORT_ATTACHMENT_MAX_PER_MESSAGE = 4;
/**
 * Tope de adjuntos pedidos y todavía sin usar por quien sube (MOVO-321): evita que un script llene la tabla y el bucket
 * con URLs que nunca se usan. Al pasarlo, `POST attachments` responde 429 `SUPPORT_ATTACHMENT_PENDING_LIMIT`.
 */
export const SUPPORT_ATTACHMENT_MAX_PENDING = 20;

/** Códigos de error de `/admin/support/*`. */
export const SUPPORT_ERROR = {
  /** 403: el admin es el usuario de la consulta (decisión 5 de MOVO-286). */
  CONFLICT: "ADMIN_CONFLICT_OF_INTEREST",
  /** 404 */
  NOT_FOUND: "SUPPORT_CONVERSATION_NOT_FOUND",
  /** 422: tipo, tamaño o cantidad de adjuntos inválidos, o adjunto ajeno/ya usado. */
  ATTACHMENT_INVALID: "SUPPORT_ATTACHMENT_INVALID",
  /** 422: el usuario de la consulta no es parte del envío a vincular. */
  SHIPMENT_NOT_PARTY: "SUPPORT_SHIPMENT_NOT_PARTY",
  /** 401/422: ticket del WS vencido, usado o de otro admin. */
  TICKET_INVALID: "SUPPORT_TICKET_INVALID",
} as const;

export interface SupportUserRef {
  id: string;
  fullName: string;
  role: SupportUserRole;
}

export interface SupportAgentRef {
  id: string;
  fullName: string;
}

/** `GET /admin/support/agents`: admins con su carga (consultas no resueltas asignadas). */
export interface SupportAgent extends SupportAgentRef {
  activeCount: number;
}

export interface SupportAttachment {
  id: string;
  contentType: SupportAttachmentType;
  width?: number;
  height?: number;
  /** Firmada y de vida corta (~15 min), generada al leer. Nunca permanente. */
  url: string;
}

interface SupportMessageBase {
  id: string;
  conversationId: string;
  createdAt: string;
  /** Idempotencia de escritura; solo en mensajes enviados por un agente. */
  clientMessageId?: string;
}

/** Mensaje del usuario. */
export interface SupportUserMessage extends SupportMessageBase {
  kind: "user";
  body: string;
  attachments: SupportAttachment[];
}

/** Respuesta de un agente (el usuario la recibe). */
export interface SupportAgentMessage extends SupportMessageBase {
  kind: "agent";
  body: string;
  attachments: SupportAttachment[];
  author: SupportAgentRef;
}

/** Nota interna: nunca llega al usuario (ni API, ni WS, ni push). */
export interface SupportInternalNote extends SupportMessageBase {
  kind: "internal_note";
  body: string;
  attachments: SupportAttachment[];
  author: SupportAgentRef;
}

/**
 * Evento de sistema; el texto lo arma el servidor en tercera persona y sin depender de quien lo
 * lee ("Tomás Ferreyra tomó la conversación", "Prioridad: alta", "Vinculada a #MOVO-48176").
 */
export interface SupportSystemMessage extends SupportMessageBase {
  kind: "system";
  body: string;
  actor: SupportAgentRef | null;
}

export type SupportMessage =
  | SupportUserMessage
  | SupportAgentMessage
  | SupportInternalNote
  | SupportSystemMessage;

/** Último mensaje visible (usuario o agente; nunca una nota ni un evento) para la vista previa. */
export interface SupportLastMessage {
  from: "user" | "agent";
  /** Id del agente autor (para mostrar "Vos:"); `null` si escribió el usuario. */
  authorId: string | null;
  authorName: string;
  body: string;
  hasAttachments: boolean;
  createdAt: string;
}

export interface SupportShipmentRef {
  id: string;
  /** `MOVO-48176`. */
  code: string;
}

/** Fila de `GET /admin/support/conversations`. */
export interface SupportConversationRow {
  id: string;
  /** `SOP-1042`. */
  code: string;
  user: SupportUserRef;
  topic: SupportTopic;
  priority: SupportPriority;
  status: SupportStatus;
  assignee: SupportAgentRef | null;
  unread: number;
  lastMessage: SupportLastMessage | null;
  /** Minutos desde el último mensaje del usuario sin respuesta; 0 si no espera. Lo calcula el servidor. */
  waitMinutes: number;
  shipment: SupportShipmentRef | null;
  tags: SupportTag[];
  lastActivityAt: string;
}

/** `GET /admin/support/conversations/:id`. */
export type SupportConversation = SupportConversationRow & {
  createdAt: string;
  resolvedAt: string | null;
};

export interface SupportListPage {
  items: SupportConversationRow[];
  nextCursor: string | null;
}

/** Más recientes primero; `nextCursor` pagina hacia atrás. */
export interface SupportMessagesPage {
  items: SupportMessage[];
  nextCursor: string | null;
}

/**
 * `GET /admin/support/counts`. `byStatus` respeta la asignación y la búsqueda pedidas;
 * `byOwner`, el estado y la búsqueda (así cada pestaña y cada chip muestra lo que traería).
 */
export interface SupportCounts {
  byStatus: Record<SupportStatus, number>;
  /** Del estado `status` pedido: Todos / Míos / Sin asignar. */
  byOwner: { all: number; mine: number; none: number };
  /** Total de no leídos (badge del menú). */
  unreadTotal: number;
}

/** `GET /admin/support/counts?status=&assignee=&q=`: mismos filtros que la lista, sin `cursor`. */
export type SupportCountsQuery = Omit<SupportListQuery, "cursor">;

/** `GET /admin/support/conversations?status=&assignee=&q=&cursor=`. */
export interface SupportListQuery {
  status: SupportStatus;
  assignee?: "me" | "none" | string;
  q?: string;
  cursor?: string;
}

/** `POST /admin/support/conversations/:id/messages`. */
export interface SupportSendBody {
  body: string;
  clientMessageId: string;
  /** `true` crea una nota interna. */
  internal?: boolean;
  attachmentIds?: string[];
}

/**
 * `PATCH /admin/support/conversations/:id`. Cada campo es opcional; `assignedTo: null` desasigna y
 * `shipmentId: null` desvincula. Asignación, prioridad, tema y vínculo dejan un evento `system`.
 */
export interface SupportPatchBody {
  assignedTo?: string | null;
  priority?: SupportPriority;
  topic?: SupportTopic;
  tags?: SupportTag[];
  shipmentId?: string | null;
}

/** `POST /admin/support/attachments` (MOVO-321 AC1). */
export interface SupportAttachmentCreateBody {
  contentType: SupportAttachmentType;
  sizeBytes: number;
  /** Para el prefijo privado `support/<conversationId>/…`. */
  conversationId: string;
}
export interface SupportAttachmentCreateResult {
  attachmentId: string;
  /** PUT con el binario y el mismo `Content-Type`. */
  uploadUrl: string;
  expiresAt: string;
}

export type SupportBadgeTone = "success" | "warning" | "info";
export type SupportVerificationBadge = "identity" | "kyc_approved" | "kyc_pending" | "license_valid";

export interface SupportUserShipment {
  id: string;
  code: string;
  status: string;
  /** "Güemes → Cofico". */
  route: string;
  /** Tono con el que se pinta el estado. */
  tone: "success" | "danger" | "info" | "warning" | "neutral";
  statusLabel: string;
  createdAt: string;
}

export interface SupportUserHistoryItem {
  conversationId: string;
  code: string;
  topic: SupportTopic;
  status: SupportStatus;
  createdAt: string;
}

/**
 * `GET /admin/support/conversations/:id/context`. Falla abierto: si `svc-users` no responde,
 * `badges` es `null` y el resto se devuelve igual.
 */
export interface SupportUserContext {
  profile: {
    id: string;
    fullName: string;
    roles: string[];
    memberSince: string;
    email: string;
    phone: string;
    /** `null` sin calificaciones. */
    ratingAverage: number | null;
    ratingCount: number;
    shipmentCount: number;
    tripCount: number;
  };
  badges: SupportVerificationBadge[] | null;
  recentShipments: SupportUserShipment[];
  otherConversations: SupportUserHistoryItem[];
}

/** Respuestas rápidas: `{nombre}` y `{agente}` son variables (MOVO-322 AC11). */
export interface SupportQuickReply {
  id: string;
  title: string;
  text: string;
}

export const SUPPORT_QUICK_REPLIES: readonly SupportQuickReply[] = [
  {
    id: "greeting",
    title: "Saludo",
    text: "Hola {nombre}, soy {agente} del equipo de Movo. Ya estoy viendo tu consulta.",
  },
  {
    id: "photos",
    title: "Pedir fotos",
    text: "¿Me mandás fotos del paquete y de la caja? Así lo revisamos con el transportista.",
  },
  {
    id: "payment-hold",
    title: "Hold de pago",
    text: "El segundo movimiento es una reserva, no un cobro. Se libera sola en hasta 48 h.",
  },
  {
    id: "kyc-retry",
    title: "Reintentar KYC",
    text: "Probá con luz natural, sin flash y con el DNI apoyado sobre una superficie oscura.",
  },
  {
    id: "escalated",
    title: "Escalado",
    text: "Lo pasé al equipo de seguridad. Te escribimos por acá apenas tengamos novedades.",
  },
  {
    id: "closing",
    title: "Cierre",
    text: "¿Te puedo ayudar con algo más? Si no, cierro la consulta.",
  },
];

/** Reemplaza `{nombre}` y `{agente}`; el panel y el backend usan esta misma función. */
export function resolveQuickReply(
  template: string,
  vars: { nombre: string; agente: string }
): string {
  return template.replaceAll("{nombre}", vars.nombre).replaceAll("{agente}", vars.agente);
}

/**
 * Eventos de tiempo real. Viajan idénticos por el WS (`/admin/support/ws`) y por el polling de
 * respaldo (`GET /admin/support/events?since=<cursor>` → `SupportEventsPage`). `cursor` es
 * monótono y opaco.
 */
export type SupportEvent =
  | { type: "conversation_created"; cursor: string; conversation: SupportConversationRow }
  | {
      type: "support_message";
      cursor: string;
      conversationId: string;
      message: SupportMessage;
      /** La fila ya con este mensaje (último mensaje, no leídos, espera): el panel no la vuelve a pedir. */
      conversation: SupportConversationRow;
    }
  | { type: "conversation_updated"; cursor: string; conversation: SupportConversationRow }
  | { type: "counts_updated"; cursor: string; counts: SupportCounts };

export interface SupportEventsPage {
  events: SupportEvent[];
  /** Cursor desde el que seguir; si es `reset`, el servidor ya no guarda tantos eventos y el cliente refetchea. */
  cursor: string;
  reset: boolean;
}

/** `POST /admin/support/realtime-ticket`: un solo uso, ~30 s, atado al admin y al origin. */
export interface SupportRealtimeTicket {
  ticket: string;
  /** `wss://…/api/v1/admin/support/ws`. */
  url: string;
  expiresAt: string;
}
/** Subprotocolo del WS: `new WebSocket(url, [SUPPORT_WS_PROTOCOL, ticket])`. El servidor responde solo el primero. */
export const SUPPORT_WS_PROTOCOL = "movo-support.v1";
