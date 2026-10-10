import { toArgentinaCalendarDateString } from "../utils/argentina-date";

/**
 * MOVO-277: regla única de "¿ya se puede iniciar este viaje?" por fecha, compartida
 * entre `movo-svc-shipments` (`POST /trips/:id/start` responde 409
 * `TRIP_START_TOO_EARLY`) y `movo-mobile` (decide si muestra "Iniciar viaje").
 *
 * Se compara el día calendario en Argentina, no la hora: el día de la salida se puede
 * iniciar a cualquier hora (el transportista suele arrancar antes de lo declarado), y
 * después de la salida también, mientras el viaje siga `declared` (el barrido de
 * vencimiento es el que lo da de baja, no esta regla). Antes de ese día, nunca.
 */
export function canStartTripOn(departureAt: Date | string, now: Date = new Date()): boolean {
  return toArgentinaCalendarDateString(departureAt) <= toArgentinaCalendarDateString(now);
}

/**
 * MOVO-277: primer día (calendario argentino, `"YYYY-MM-DD"`) en que el viaje se
 * puede iniciar -- el de su salida. Para el texto "Podés iniciarlo el {fecha}" del
 * mobile y el mensaje del 409.
 */
export function tripStartAvailableOn(departureAt: Date | string): string {
  return toArgentinaCalendarDateString(departureAt);
}
