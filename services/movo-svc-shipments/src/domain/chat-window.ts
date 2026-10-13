import { ChatAccess, CHAT_POST_DELIVERY_WINDOW_HOURS, ShipmentStatus, UserRole } from "@movo/shared";
import { Shipment } from "../models/shipment";

/**
 * MOVO-26 (ADR-040): con transportista asignado y hasta que el paquete se entrega. Los envíos
 * `published` o anteriores no tienen transportista; `cancelled` y `rejected_by_receiver` cierran el chat.
 */
const CHAT_OPEN_STATUSES: readonly ShipmentStatus[] = [
  ShipmentStatus.ASSIGNMENT_PENDING,
  ShipmentStatus.ASSIGNED_UNFUNDED,
  ShipmentStatus.ASSIGNED,
  ShipmentStatus.IN_TRANSIT,
];

/** Envíos cuyo chat se corta en el acto (se cierran los sockets). La ventana post-entrega la corta un timer. */
export const CHAT_CLOSING_STATUSES: readonly ShipmentStatus[] = [
  ShipmentStatus.CANCELLED,
  ShipmentStatus.REJECTED_BY_RECEIVER,
];

/** Instante en que se cierra el chat de un envío entregado, o `null` si todavía no se entregó. */
export function chatWindowDeadline(shipment: Pick<Shipment, "deliveredAt">): Date | null {
  if (!shipment.deliveredAt) return null;
  return new Date(shipment.deliveredAt.getTime() + CHAT_POST_DELIVERY_WINDOW_HOURS * 60 * 60 * 1000);
}

/**
 * Qué puede hacer `viewer` con el chat del envío. Asume que ya pasó el chequeo de acceso al
 * envío (`hasShipmentAccess`): acá solo se decide el estado del hilo.
 *
 * - El envío con transportista y sin entregar → `open`; entregado → `open` hasta 24 h después.
 * - `disputed` → `read_only` (la evidencia queda, pero no se sigue conversando).
 * - Cualquier otro estado, o fuera de la ventana → `closed` para las partes.
 * - El receptor que transfirió la recepción (ADR-038) nunca pasa de `read_only`.
 * - El admin siempre lee (`read_only`) y nunca escribe: el historial es evidencia de disputa.
 */
export function resolveChatAccess(input: {
  shipment: Shipment;
  viewerId: string;
  viewerRoles: readonly UserRole[];
  now: Date;
}): ChatAccess {
  const { shipment, viewerId, viewerRoles, now } = input;

  const isParty =
    viewerId === shipment.senderId ||
    viewerId === shipment.receiverId ||
    (shipment.carrierId !== null && viewerId === shipment.carrierId);
  if (!isParty && viewerRoles.includes(UserRole.ADMIN)) return "read_only";

  const isFormerReceiver = !isParty && shipment.formerReceiverId != null && shipment.formerReceiverId === viewerId;

  let access: ChatAccess;
  if (shipment.status === ShipmentStatus.DISPUTED) {
    access = "read_only";
  } else if (shipment.carrierId === null) {
    access = "closed";
  } else if (CHAT_OPEN_STATUSES.includes(shipment.status)) {
    access = "open";
  } else if (shipment.status === ShipmentStatus.DELIVERED || shipment.status === ShipmentStatus.COMPLETED) {
    const deadline = chatWindowDeadline(shipment);
    access = deadline !== null && now.getTime() <= deadline.getTime() ? "open" : "closed";
  } else {
    access = "closed";
  }

  if (access === "open" && isFormerReceiver) return "read_only";
  return access;
}
