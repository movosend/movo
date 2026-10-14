/**
 * Contratos de `svc-admin` (MOVO-288): bitácora de acciones del panel y las partes de
 * un objetivo que los servicios dueños exponen por endpoints internos para la regla de
 * conflicto de interés.
 */

/** Resultado de una acción del admin: nunca queda `succeeded` algo que no ocurrió. */
export type AuditOutcome = "succeeded" | "failed";

/** Sobre qué actúa un admin. Cada tipo decide cómo se resuelve el conflicto de interés. */
export type AdminTargetType = "user" | "admin_role" | "shipment" | "chat_report" | "user_report";

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
  /** Receptores anteriores (transferencia, ADR-038, o redesignación tras un rechazo, ADR-027). */
  formerReceiverIds: string[];
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
