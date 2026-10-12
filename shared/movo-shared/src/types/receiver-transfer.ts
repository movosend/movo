import { ShipmentStatus } from "./shipment";

/**
 * MOVO-275 (ADR-038): transferencia de receptor. El receptor actual de un envío ya
 * aceptado le pasa la recepción a otra persona, que tiene que aceptar. Es una entidad
 * paralela al ciclo de vida del envío: nunca cambia `Shipment.status`.
 *
 * - `pending_new_receiver`: esperando que la persona invitada acepte o rechace.
 * - `completed`: la invitada aceptó; el envío ya tiene su `receiverId`.
 * - `rejected_by_new_receiver`: la invitada rechazó.
 * - `expired`: venció `newReceiverDeadline` sin respuesta.
 * - `cancelled`: la canceló quien la pidió o empezó el handshake de entrega
 *   (`cancelReason` dice cuál).
 */
export const RECEIVER_TRANSFER_STATUSES = [
  "pending_new_receiver",
  "completed",
  "rejected_by_new_receiver",
  "expired",
  "cancelled",
] as const;

export type ReceiverTransferStatus = (typeof RECEIVER_TRANSFER_STATUSES)[number];

export type ReceiverTransferCancelReason = "requester" | "delivery_started";

/**
 * Estados del envío en los que el receptor puede pedir una transferencia: desde que
 * aceptó el envío hasta que el paquete está en camino. La entrega ya iniciada se
 * controla aparte (handshake de entrega pendiente).
 */
export const RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  ShipmentStatus.PUBLISHED,
  ShipmentStatus.ASSIGNMENT_PENDING,
  ShipmentStatus.ASSIGNED_UNFUNDED,
  ShipmentStatus.ASSIGNED,
  ShipmentStatus.IN_TRANSIT,
];

/** Wire contract de una solicitud de transferencia. Fechas en ISO 8601. */
export interface ReceiverTransferRequest {
  id: string;
  shipmentId: string;
  /** Receptor que pidió la transferencia (el receptor original). */
  requestedBy: string;
  /** Nombre de quien la pidió al momento de pedirla (snapshot, puede ser null). */
  requesterName: string | null;
  newReceiverId: string;
  /** Nombre de la persona invitada al momento de pedirla (snapshot, puede ser null). */
  newReceiverName: string | null;
  /** Motivo opcional de quien la pidió. */
  reason: string | null;
  /** Motivo opcional del rechazo de la persona invitada. */
  responseReason: string | null;
  status: ReceiverTransferStatus;
  cancelReason: ReceiverTransferCancelReason | null;
  newReceiverDeadline: string;
  createdAt: string;
  /** Instante en que la solicitud dejó de estar pendiente. */
  resolvedAt: string | null;
  /** Quién la resolvió (la invitada, quien la pidió, o null si fue el sistema). */
  resolvedBy: string | null;
}

/**
 * Lo mínimo del envío que necesita la persona invitada para decidir, antes de tener
 * acceso al envío: dónde lo recibe, qué es y quiénes participan.
 */
export interface ReceiverTransferInvitationShipment {
  id: string;
  status: ShipmentStatus;
  senderId: string;
  carrierId: string | null;
  packageType: string;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description: string | null;
  deliveryAddress: string;
}

export interface ReceiverTransferInvitation extends ReceiverTransferRequest {
  shipment: ReceiverTransferInvitationShipment;
}

/**
 * Resumen de la transferencia que viaja en el detalle del envío, armado según quién
 * mira. `pending` solo lo ven quien la pidió y el emisor; `completed` lo ven todas las
 * partes. `viewerIsFormerReceiver` es true cuando quien mira le pasó la recepción a
 * otra persona: ve el envío en solo lectura.
 */
export interface ShipmentReceiverTransferSummary {
  viewerIsFormerReceiver: boolean;
  pending: ReceiverTransferRequest | null;
  completed: ReceiverTransferRequest | null;
}
