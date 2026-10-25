/**
 * Contratos de `svc-admin` (MOVO-288): bitácora de acciones del panel y las partes de
 * un objetivo que los servicios dueños exponen por endpoints internos para la regla de
 * conflicto de interés.
 */

/**
 * Resultado de una acción del admin. `succeeded` nunca es algo que no ocurrió; `failed` es un
 * rechazo seguro (la acción no se aplicó); `unknown` es que el servicio dueño no respondió (red,
 * timeout, 5xx) y la acción pudo haberse aplicado igual: hay que verificarlo en ese servicio.
 */
export type AuditOutcome = "succeeded" | "failed" | "unknown";

/** Sobre qué actúa un admin. Cada tipo decide cómo se resuelve el conflicto de interés. */
export type AdminTargetType =
  | "user"
  | "admin_role"
  | "shipment"
  | "chat_report"
  | "user_report"
  /** MOVO-322: una consulta de soporte; el admin es parte si es el usuario que la abrió. */
  | "support_conversation"
  /** MOVO-337: una disputa; el admin es parte si lo es del envío disputado. */
  | "dispute";

/** Fila de `GET /admin/audit-log`. */
export interface AuditLogEntry {
  id: string;
  adminId: string;
  action: string;
  targetType: AdminTargetType;
  targetId: string;
  reason: string | null;
  context: Record<string, unknown> | null;
  outcome: AuditOutcome;
  /** Código de `ApiError` con el que falló la acción; `null` si salió bien. */
  errorCode: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  nextCursor: string | null;
}

/** `GET /internal/shipments/:id/parties` de `svc-shipments`. */
export interface ShipmentParties {
  shipmentId: string;
  senderId: string;
  carrierId: string | null;
  receiverId: string | null;
  /** Receptores anteriores (transferencia, DD-038, o redesignación tras un rechazo, DD-027). */
  formerReceiverIds: string[];
}

/** Un envío en curso de un usuario (`GET /internal/users/:id/in-progress-shipments` de `svc-shipments`, MOVO-297). */
export interface InProgressShipment {
  id: string;
  shortId: string;
  status: "assignment_pending" | "assigned_unfunded" | "assigned" | "in_transit";
  userRole: "sender" | "carrier" | "receiver";
  pickupAddress: string;
  deliveryAddress: string;
}

/** `POST /internal/users/:id/withdraw-open-activity` de `svc-shipments` (MOVO-297): lo retirado, para la bitácora (body opcional `{ sanctionId }`). */
export interface WithdrawOpenActivityResult {
  cancelledShipmentIds: string[];
  withdrawnOfferIds: string[];
  cancelledTripIds: string[];
  /** Viajes cuya serie recurrente se cortó (incluye la de un viaje ya `active`, que no se cancela). */
  stoppedRecurrenceTripIds: string[];
  /** Contrapartes avisadas de los envíos en curso (un push por contraparte y envío; no repite en reintentos). */
  notifiedCounterpartyCount: number;
  /**
   * Lo que no se pudo retirar por un error real (no por perder una carrera con otro flujo). Si no está vacío,
   * la sanción no puede darse por aplicada: es idempotente, se reintenta. Para `series`, `id` es el usuario.
   */
  failures: Array<{ kind: "shipment" | "offer" | "trip" | "series"; id: string }>;
}

/**
 * `GET /internal/users/:id/open-activity` de `svc-shipments` (MOVO-299): lo que retiraría hoy
 * `withdraw-open-activity`, sin tocar nada, más lo que sigue su curso. Para el texto que el panel
 * muestra antes de confirmar una sanción.
 */
export interface OpenActivitySummary {
  /** Envíos como emisor todavía sin comprometer (esperando o rechazados por el receptor, o publicados). */
  shipments: number;
  /** Ofertas `pending` vigentes como transportista. */
  offers: number;
  /** Viajes `declared`. Uno con paquetes aceptados no se cancela, pero se cuenta igual. */
  trips: number;
  /** Series recurrentes vigentes que se cortarían (también la de un viaje en curso). */
  recurringSeries: number;
  inProgressShipments: InProgressShipment[];
}

/** `GET /internal/chat-reports/:id/parties` de `svc-shipments`: quien reportó y las partes del envío. */
export interface ChatReportParties {
  reportId: string;
  shipmentId: string;
  reporterId: string;
  partyIds: string[];
}

/** `GET /internal/user-reports/:id/parties` de `svc-users`. */
export interface UserReportParties {
  reportId: string;
  reporterId: string;
  reportedId: string;
}
