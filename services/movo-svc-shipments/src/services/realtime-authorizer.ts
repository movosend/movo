import { ApiError, verifyAccessToken } from "@movo/shared";
import { TRACKING_CLOSED_STATUSES } from "../domain/shipment-state-machine";
import { Shipment } from "../models/shipment";
import { ShipmentRepository } from "../repositories/shipment-repository";
import { assertShipmentAccess } from "../modules/shipments/assert-shipment-access";

export interface AuthorizedRealtimeConnection {
  shipment: Shipment;
  callerId: string;
  /** `exp` del JWT en ms epoch -- MOVO-250/AC7: la conexión se cierra al llegar a este instante. */
  tokenExpiresAtMs: number;
}

/**
 * MOVO-201/AC2-AC3: valida el JWT del handshake inicial (misma librería compartida de
 * MOVO-67 que usa el resto de los servicios, ver ADR-010) y autoriza la suscripción por
 * pertenencia al envío -- emisor, receptor, transportista asignado o admin. Extraído de
 * la PoC de MOVO-200 (`tracking-poc.routes.ts`) para que cualquier canal de tiempo real
 * futuro (chat de MOVO-26, eventos de handshake) lo reuse sin reimplementar la
 * verificación (AC8: el canal es agnóstico del tipo de mensaje, no de la autorización).
 *
 * Nunca lanza para "conexión sin token" ni "sin permiso" -- siempre `ApiError`, para que
 * el caller (la ruta WS) decida el código de cierre sin tener que inspeccionar el tipo
 * de excepción.
 */
export async function authorizeRealtimeConnection(
  shipmentRepository: ShipmentRepository,
  authorizationHeader: string | undefined,
  shipmentId: string
): Promise<AuthorizedRealtimeConnection> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new ApiError(401, "AUTH_TOKEN_INVALID", "Falta el header Authorization.");
  }

  const result = verifyAccessToken(authorizationHeader.slice(7));
  if (result.status === "invalid") {
    throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token inválido o vencido.");
  }
  const { sub: callerId, roles: callerRoles, exp } = result.claims;

  const shipment = await shipmentRepository.findById(shipmentId);
  if (!shipment) {
    throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
  }

  if (callerId !== shipment.carrierId) {
    assertShipmentAccess(shipment, callerId, callerRoles, "No tenés permiso para ver el tracking de este envío.");
  }

  return { shipment, callerId, tokenExpiresAtMs: exp * 1000 };
}

/** AC4: el envío ya está en un estado donde el tracking no debería mostrarse. */
export function isTrackingClosedForShipment(shipment: Shipment): boolean {
  return TRACKING_CLOSED_STATUSES.includes(shipment.status);
}
