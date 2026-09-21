import { ApiError, UserRole } from "@movo/shared";
import { Trip } from "../../models/trip";

/**
 * Chequea que el caller sea dueño del viaje (o admin, salvo `allowAdmin: false`).
 * MOVO-235 (review): este bloque se copiaba a mano en cada endpoint con `tripId`
 * (trips.service.ts x5, shipments.service.ts x2) y había empezado a driftear --
 * `getMyRoute` nunca contempló el bypass de admin que sí tenían `getTrip`/
 * `getTripMatches`. No incluye la carga del viaje (`tripRepository.findById` + 404)
 * -- mismo criterio que `assertShipmentAccess` (`../shipments/assert-shipment-
 * access.ts`): cada caller resuelve esa parte porque ya tiene el resultado de esa
 * consulta a mano.
 */
export function assertTripAccess(
  trip: Trip,
  callerId: string,
  callerRoles: UserRole[],
  options: { allowAdmin?: boolean; forbiddenMessage?: string } = {},
): void {
  const { allowAdmin = true, forbiddenMessage = "No tenés permiso para acceder a este viaje." } = options;
  const isAdmin = allowAdmin && callerRoles.includes(UserRole.ADMIN);
  if (trip.carrierId !== callerId && !isAdmin) {
    throw new ApiError(403, "AUTH_FORBIDDEN", forbiddenMessage);
  }
}
