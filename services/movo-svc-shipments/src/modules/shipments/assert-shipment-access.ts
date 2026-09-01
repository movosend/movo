import { ApiError, UserRole } from "@movo/shared";
import { Shipment } from "../../models/shipment";

/**
 * Chequea que el usuario tenga acceso al envío (emisor, receptor o admin).
 * AC8 de MOVO-80 / MOVO-81 / MOVO-128: 403 explícito, nunca 404 "filtrado" —
 * el id es un UUID no adivinable.
 */
export function assertShipmentAccess(
  shipment: Shipment,
  callerId: string,
  callerRoles: UserRole[],
  forbiddenMessage = "No tenés permiso para ver este envío."
): void {
  const isParty = callerId === shipment.senderId || callerId === shipment.receiverId;
  const isAdmin = callerRoles.includes(UserRole.ADMIN);
  if (!isParty && !isAdmin) {
    throw new ApiError(403, "AUTH_FORBIDDEN", forbiddenMessage);
  }
}

/**
 * Chequea que el usuario sea estrictamente el receptor designado del envío (MOVO-129).
 * A diferencia de `assertShipmentAccess`, ni el emisor ni el admin pueden aceptar o rechazar.
 */
export function assertIsReceiver(shipment: Shipment, callerId: string): void {
  if (callerId !== shipment.receiverId) {
    throw new ApiError(403, "AUTH_FORBIDDEN", "Solo el receptor designado puede aceptar o rechazar este envío.");
  }
}

/**
 * AC1 de MOVO-144: solo el emisor del envío o un admin pueden ver la lista de
 * ofertas — a diferencia de `assertShipmentAccess`, el receptor NO tiene acceso acá
 * (no participa de la negociación de ofertas).
 */
export function assertIsSenderOrAdmin(shipment: Shipment, callerId: string, callerRoles: UserRole[]): void {
  const isSender = callerId === shipment.senderId;
  const isAdmin = callerRoles.includes(UserRole.ADMIN);
  if (!isSender && !isAdmin) {
    throw new ApiError(403, "AUTH_FORBIDDEN", "Solo el emisor del envío puede ver sus ofertas.");
  }
}

/**
 * AC6 de MOVO-144: solo el emisor del envío puede aceptar o rechazar una oferta —
 * estrictamente, sin admin, mismo criterio que `assertIsReceiver` (acción de
 * negocio, no lectura).
 */
export function assertIsSender(shipment: Shipment, callerId: string): void {
  if (callerId !== shipment.senderId) {
    throw new ApiError(403, "AUTH_FORBIDDEN", "Solo el emisor del envío puede aceptar o rechazar una oferta.");
  }
}

/**
 * AC3 de MOVO-143: ni el emisor ni el receptor de un envío pueden ofertar sobre su
 * propio envío -- la negociación es entre el emisor y transportistas terceros.
 */
export function assertIsNotShipmentParty(shipment: Shipment, callerId: string): void {
  if (callerId === shipment.senderId || callerId === shipment.receiverId) {
    throw new ApiError(403, "AUTH_FORBIDDEN", "No podés ofertar sobre tu propio envío.");
  }
}
