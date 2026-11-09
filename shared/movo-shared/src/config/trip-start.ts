import { toArgentinaCalendarDateString } from "../utils/argentina-date";

/**
 * DD-060: días calendario antes de la salida en que el viaje ya se puede iniciar. Mismo
 * margen que `OFFER_DATE_MAX_FORWARD_OFFSET_DAYS`: alcanza para adelantar un viaje sin dejar
 * un `active` abierto durante semanas.
 */
export const TRIP_START_MAX_DAYS_EARLY = 3;

/**
 * DD-060: tolerancia hacia atrás de `departureAt` al crear o editar un viaje. El reloj del teléfono
 * y la latencia no pueden hacer fallar un "salgo ahora". La usan `movo-svc-shipments`
 * (`TRIP_DEPARTURE_IN_PAST`) y el formulario de viaje del mobile, para que los dos coincidan.
 */
export const TRIP_DEPARTURE_PAST_TOLERANCE_MS = 5 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

function shiftCalendarDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * MOVO-277: regla única de "¿ya se puede iniciar este viaje?" por fecha, compartida
 * entre `movo-svc-shipments` (`POST /trips/:id/start` responde 409
 * `TRIP_START_TOO_EARLY`) y `movo-mobile` (decide si muestra "Iniciar viaje").
 *
 * Se compara el día calendario en Argentina, no la hora: desde el primer día habilitado
 * se puede iniciar a cualquier hora, y después de la salida también, mientras el viaje siga
 * `declared` (el barrido de vencimiento es el que lo da de baja, no esta regla).
 */
export function canStartTripOn(departureAt: Date | string, now: Date = new Date()): boolean {
  return tripStartAvailableOn(departureAt) <= toArgentinaCalendarDateString(now);
}

/**
 * MOVO-277: primer día (calendario argentino, `"YYYY-MM-DD"`) en que el viaje se
 * puede iniciar. Para el texto "Podés iniciarlo el {fecha}" del mobile y el mensaje del 409.
 */
export function tripStartAvailableOn(departureAt: Date | string): string {
  return shiftCalendarDate(toArgentinaCalendarDateString(departureAt), -TRIP_START_MAX_DAYS_EARLY);
}
