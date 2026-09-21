/**
 * Estado del ciclo de vida de un viaje declarado por un transportista.
 *
 * MOVO-161: active | cancelled | completed
 * MOVO-221: se agrega `declared` como estado inicial real (antes un viaje nacía
 * directo en `active`, sin ningún paso explícito de "arrancar el viaje"). Ciclo
 * completo: `declared` (recién creado, `departureAt` todavía no llegó) ->
 * `active` (el transportista tocó "Iniciar viaje", `POST /trips/:id/start` --
 * solo puede haber 1 `active` por cuenta a la vez) -> `completed`. `cancelled`
 * sin cambios de semántica, alcanzable desde cualquier estado no terminal.
 */
export enum TripStatus {
  DECLARED = "declared",
  ACTIVE = "active",
  CANCELLED = "cancelled",
  COMPLETED = "completed",
}
