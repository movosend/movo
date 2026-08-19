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
