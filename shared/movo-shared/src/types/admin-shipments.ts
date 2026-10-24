/**
 * Contratos de los envíos en el panel de administración (MOVO-325, backend de MOVO-33). El panel
 * habla con `svc-admin` (`/admin/shipments*`), que consulta a `svc-shipments` por endpoints
 * internos y completa con `svc-users` y `svc-payments`.
 */
import { ShipmentStatus } from "./shipment";
import type { ChatAccess, ChatParticipantRole } from "./chat";
import type { HoldDetailResponse } from "./hold";

/**
 * Estados en los que un envío se considera **activo**: todos los no terminales. Incluye
 * `awaiting_receiver_confirmation` y `rejected_by_receiver` (el receptor todavía puede decidir o
 * el emisor elegir otro, ADR-027), que el listado de operación no puede perder de vista.
 */
export const ACTIVE_SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
  ShipmentStatus.REJECTED_BY_RECEIVER,
  ShipmentStatus.PUBLISHED,
  ShipmentStatus.ASSIGNMENT_PENDING,
  ShipmentStatus.ASSIGNED_UNFUNDED,
  ShipmentStatus.ASSIGNED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.DISPUTED,
];

/** Pestañas del listado del panel. `all` no es un grupo: son los activos por defecto. */
export const ADMIN_SHIPMENT_GROUPS = ["unassigned", "assigning", "in_progress", "closed", "disputes"] as const;
export type AdminShipmentGroup = (typeof ADMIN_SHIPMENT_GROUPS)[number];

/** Qué estados componen cada pestaña (cada estado está en exactamente una). */
export const ADMIN_SHIPMENT_GROUP_STATUSES: Readonly<Record<AdminShipmentGroup, readonly ShipmentStatus[]>> = {
  unassigned: [
    ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
    ShipmentStatus.REJECTED_BY_RECEIVER,
    ShipmentStatus.PUBLISHED,
  ],
  assigning: [ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.ASSIGNED_UNFUNDED],
  in_progress: [ShipmentStatus.ASSIGNED, ShipmentStatus.IN_TRANSIT],
  closed: [ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED, ShipmentStatus.CANCELLED],
  disputes: [ShipmentStatus.DISPUTED],
};

/**
 * Estados que por sí solos piden atención de operación: plazo de pago abierto, plazo del emisor para
 * elegir otro receptor y disputa. Un `in_transit` lo pide solo si está demorado (`delayed`).
 */
export const ADMIN_SHIPMENT_ALERT_STATUSES: readonly ShipmentStatus[] = [
  ShipmentStatus.ASSIGNED_UNFUNDED,
  ShipmentStatus.REJECTED_BY_RECEIVER,
  ShipmentStatus.DISPUTED,
];

/** Si una fila lleva aviso en el panel. Es la misma regla que aplica el filtro `alert` del listado. */
export function isAdminShipmentAlert(row: Pick<AdminShipmentRow, "status" | "delayed">): boolean {
  return row.delayed || (ADMIN_SHIPMENT_ALERT_STATUSES as readonly string[]).includes(row.status);
}

/** Límites de página del listado (y del chat) del panel. */
export const ADMIN_SHIPMENTS_DEFAULT_LIMIT = 25;
export const ADMIN_SHIPMENTS_MAX_LIMIT = 100;

/** Una de las tres partes de un envío; `name` es el último conocido por `svc-shipments`. */
export interface AdminShipmentPartyRef {
  id: string;
  name: string | null;
}

/** Fila de `GET /admin/shipments`. */
export interface AdminShipmentRow {
  id: string;
  /** Código corto: los primeros 8 caracteres del id, el mismo "#" que muestra la app. */
  code: string;
  status: `${ShipmentStatus}`;
  sender: AdminShipmentPartyRef;
  carrier: AdminShipmentPartyRef | null;
  receiver: AdminShipmentPartyRef;
  pickupCity: string | null;
  pickupAddress: string;
  deliveryCity: string | null;
  deliveryAddress: string;
  /** `YYYY-MM-DD` y `HH:MM`, hora de Argentina. */
  pickupDate: string;
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
  /** Precio acordado; sin transportista, el sugerido. `null` si es "precio a estimar". */
  priceArs: number | null;
  priceKind: "agreed" | "suggested" | null;
  /** Último cambio de estado (o la creación si nunca cambió). */
  lastStatusChangeAt: string;
  /** `in_transit` marcado como demorado por el barrido (ADR-045). */
  delayed: boolean;
  /** Disputa asociada. `null` hasta que exista el módulo de disputas (MOVO-34). */
  disputeId: string | null;
  /** Plazo para fondear una asignación (`assigned_unfunded`). */
  fundingDeadline: string | null;
  /** Plazo del emisor para elegir otro receptor (`rejected_by_receiver`). */
  redesignationDeadline: string | null;
}

/** Conteos de las pestañas, con los mismos filtros de búsqueda que la lista. */
export type AdminShipmentCounts = Record<"all" | AdminShipmentGroup, number>;

/** `GET /admin/shipments`. */
export interface AdminShipmentPage {
  items: AdminShipmentRow[];
  nextCursor: string | null;
  counts: AdminShipmentCounts;
  /** Conteo de cada estado con los mismos filtros, para los chips dentro de una pestaña. */
  statusCounts: Record<`${ShipmentStatus}`, number>;
  /** De cada pestaña, cuántos llevan aviso (`isAdminShipmentAlert`), para el toggle "Con alerta". */
  alertCounts: AdminShipmentCounts;
}

/** Evento del historial de un envío. */
export interface AdminShipmentEvent {
  id: string;
  fromStatus: `${ShipmentStatus}` | null;
  toStatus: `${ShipmentStatus}`;
  actorId: string | null;
  /** MOVO-331: nombre del admin si lo hizo el panel (`kind` distinto de `normal`); `null` en el resto. */
  actorName: string | null;
  reason: string | null;
  /** MOVO-331 (ADR-055): `manual` = transición normal hecha por un admin, `forced` = con efectos distintos del camino normal. */
  kind: ShipmentEventKind;
  createdAt: string;
}

/** MOVO-331 (ADR-055): quién y cómo originó el cambio de estado. Inmutable una vez escrito. */
export type ShipmentEventKind = "normal" | "manual" | "forced";

/** `POST /internal/admin/shipments/:id/force-status` (lo llama `svc-admin`). */
export interface ForceShipmentStatusRequest {
  targetStatus: `${ShipmentStatus}`;
  /** El estado que vio el admin: si el actual es otro, 409 `STATUS_CHANGED`. */
  expectedStatus: `${ShipmentStatus}`;
  reason: string;
  adminId: string;
  adminName: string;
  idempotencyKey: string;
}

export interface ForceShipmentStatusResponse {
  shipmentId: string;
  fromStatus: `${ShipmentStatus}`;
  toStatus: `${ShipmentStatus}`;
  kind: Exclude<ShipmentEventKind, "normal">;
  /** `true` si es la respuesta guardada de una `idempotencyKey` ya ejecutada. */
  replayed: boolean;
}

export const FORCE_STATUS_REASON_MIN_LENGTH = 20;
export const FORCE_STATUS_REASON_MAX_LENGTH = 500;

/** Foto de retiro o entrega, con URL firmada de vida corta. */
export interface AdminShipmentPhoto {
  id: string;
  stage: "creation" | "pickup" | "delivery";
  url: string;
  createdAt: string;
}

/** Estado del pago de `svc-payments`. */
export type AdminShipmentPayment = HoldDetailResponse | null;

/** Verificación y reputación de una parte, de `svc-users`. */
export interface AdminShipmentPartyCard {
  id: string;
  role: ChatParticipantRole;
  fullName: string;
  photoUrl: string | null;
  accountStatus: "active" | "suspended" | "banned" | "deleted";
  identityVerified: boolean;
  licenseVerified: boolean;
  reputationScore: number | null;
  ratingCount: number;
}

/** Un bloque del detalle: o trae el dato, o la causa por la que no se pudo obtener. */
export type AdminBlock<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };

/** `GET /internal/admin/shipments/:id` de `svc-shipments`: el envío completo, sin bloques de otros servicios. */
export interface AdminShipmentDetail extends AdminShipmentRow {
  packageType: string;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description: string | null;
  urgent: boolean;
  pickupLat: number;
  pickupLng: number;
  deliveryLat: number;
  deliveryLng: number;
  suggestedPriceArs: number | null;
  agreedPriceArs: number | null;
  paymentMethod: string | null;
  highDemand: boolean | null;
  estimatedDeliveryDate: string | null;
  deliveredAt: string | null;
  receiverConfirmationDeadline: string | null;
  transitAnomalyFlaggedAt: string | null;
  chatStartedAt: string | null;
  cancellationPenaltyArs: number | null;
  createdAt: string;
}

/** `GET /admin/shipments/:id`: el envío y sus bloques; un bloque caído no tumba al resto. */
export interface AdminShipmentDetailResponse {
  shipment: AdminShipmentDetail;
  events: AdminBlock<AdminShipmentEvent[]>;
  photos: AdminBlock<AdminShipmentPhoto[]>;
  payment: AdminBlock<AdminShipmentPayment>;
  parties: AdminBlock<AdminShipmentPartyCard[]>;
}

/** Mensaje del chat tal cual se escribió: el admin ve todo (ADR-040). */
export interface AdminChatMessage {
  id: string;
  authorId: string;
  authorName: string | null;
  authorRole: ChatParticipantRole | null;
  body: string;
  /** El filtro de lenguaje tapó palabras de `body`. */
  moderated: boolean;
  createdAt: string;
}

/** Quién reportó la conversación. */
export interface AdminChatReport {
  reporterId: string;
  reporterRole: ChatParticipantRole | null;
  createdAt: string;
}

/** `GET /admin/shipments/:id/chat/messages`: del más reciente al más antiguo. */
export interface AdminChatPage {
  items: AdminChatMessage[];
  nextCursor: string | null;
  /** Qué pueden hacer hoy las partes: `open` escriben, `read_only` solo leen, `closed` ya no ven el hilo. */
  partiesAccess: ChatAccess;
  /** Entregado hace más de 24 h. */
  archived: boolean;
  /** Reportes de las partes (vacío si nadie reportó). */
  reports: AdminChatReport[];
  /** Eventos del envío, para intercalar en el hilo por fecha. */
  events: AdminShipmentEvent[];
}
