import { ChatAccess, CHAT_POST_DELIVERY_WINDOW_HOURS, ShipmentStatus, UserRole } from "@movo/shared";
import { Shipment } from "../models/shipment";

/** Lo mínimo del envío que decide el estado del chat (la lista de chats no carga el modelo completo). */
export type ChatShipmentFacts = Pick<
  Shipment,
  "status" | "senderId" | "receiverId" | "carrierId" | "deliveredAt" | "formerReceiverId"
>;

/** Con transportista asignado y el paquete sin entregar: se conversa. */
const CHAT_OPEN_STATUSES: readonly ShipmentStatus[] = [
  ShipmentStatus.ASSIGNMENT_PENDING,
  ShipmentStatus.ASSIGNED_UNFUNDED,
  ShipmentStatus.ASSIGNED,
  ShipmentStatus.IN_TRANSIT,
];

/** Entregado o en disputa: el hilo se conserva legible, sin mensajes nuevos. */
const CHAT_READ_ONLY_STATUSES: readonly ShipmentStatus[] = [
  ShipmentStatus.DELIVERED,
  ShipmentStatus.COMPLETED,
  ShipmentStatus.DISPUTED,
];

/** Envíos cuyo chat se corta en el acto (se cierran los sockets). */
export const CHAT_CLOSING_STATUSES: readonly ShipmentStatus[] = [
  ShipmentStatus.CANCELLED,
  ShipmentStatus.REJECTED_BY_RECEIVER,
];

/** Estados de envío que pueden tener un chat visible para las partes (los de la lista de chats). */
export const CHAT_LISTABLE_STATUSES: readonly ShipmentStatus[] = [...CHAT_OPEN_STATUSES, ...CHAT_READ_ONLY_STATUSES];

/** Instante desde el que el chat de un envío entregado se considera archivado, o `null` si no se entregó. */
export function chatArchiveInstant(shipment: Pick<ChatShipmentFacts, "deliveredAt">): Date | null {
  if (!shipment.deliveredAt) return null;
  return new Date(shipment.deliveredAt.getTime() + CHAT_POST_DELIVERY_WINDOW_HOURS * 60 * 60 * 1000);
}

/** Entregado hace más de 24 h: sigue legible pero la app lo muestra como archivado. */
export function isChatArchived(shipment: ChatShipmentFacts, now: Date): boolean {
  if (shipment.status !== ShipmentStatus.DELIVERED && shipment.status !== ShipmentStatus.COMPLETED) return false;
  const archiveAt = chatArchiveInstant(shipment);
  return archiveAt !== null && now.getTime() > archiveAt.getTime();
}

/**
 * Qué puede hacer `viewer` con el chat del envío. Asume que ya pasó el chequeo de acceso al
 * envío (`hasShipmentAccess`): acá solo se decide el estado del hilo.
 *
 * - Con transportista y sin entregar → `open`.
 * - Entregado/completado o en disputa → `read_only` (también pasadas las 24 h: archivado, no cerrado).
 * - Cualquier otro estado, o sin transportista → `closed` para las partes.
 * - El receptor que transfirió la recepción (DD-038) nunca pasa de `read_only`.
 * - El admin siempre lee (`read_only`) y nunca escribe: el historial es evidencia de disputa.
 */
export function resolveChatAccess(input: {
  shipment: ChatShipmentFacts;
  viewerId: string;
  viewerRoles: readonly UserRole[];
}): ChatAccess {
  const { shipment, viewerId, viewerRoles } = input;

  const isParty =
    viewerId === shipment.senderId ||
    viewerId === shipment.receiverId ||
    (shipment.carrierId !== null && viewerId === shipment.carrierId);
  if (!isParty && viewerRoles.includes(UserRole.ADMIN)) return "read_only";

  const isFormerReceiver = !isParty && shipment.formerReceiverId != null && shipment.formerReceiverId === viewerId;

  let access: ChatAccess;
  if (shipment.carrierId === null) {
    access = "closed";
  } else if (CHAT_OPEN_STATUSES.includes(shipment.status)) {
    access = "open";
  } else if (CHAT_READ_ONLY_STATUSES.includes(shipment.status)) {
    access = "read_only";
  } else {
    access = "closed";
  }

  if (access === "open" && isFormerReceiver) return "read_only";
  return access;
}
