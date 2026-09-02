/**
 * Estado del ciclo de vida de un viaje declarado por un transportista.
 *
 * MOVO-161: active | cancelled | completed
 */
export enum TripStatus {
  ACTIVE = "active",
  CANCELLED = "cancelled",
  COMPLETED = "completed",
}
