import { toArgentinaCalendarDateString } from "@movo/shared";

// La app opera solo en Argentina (mismo criterio que `ARGENTINA_UTC_OFFSET_HOURS` en
// `shipments.service.ts`) — sin DST, por lo que el offset es constante.
const ARGENTINA_UTC_OFFSET_HOURS = 3;

/** "HH:MM:SS" (formato de `Offer.offeredPickupTimeWindowStart/End`, MOVO-177) -> hora
 * de reloj de pared, mismo shape que devuelve leer un `Date` @db.Time con getUTCHours/
 * Minutes/Seconds. Compartido por `anchorTimeOfDayToInstant` para poder combinar tanto
 * un `Date` @db.Time ya persistido como el string crudo de una franja propuesta. */
function timeOfDay(time: Date | string): { hours: number; minutes: number; seconds: number } {
  if (typeof time === "string") {
    const [hours, minutes, seconds] = time.split(":").map(Number);
    return { hours, minutes, seconds: seconds ?? 0 };
  }
  return { hours: time.getUTCHours(), minutes: time.getUTCMinutes(), seconds: time.getUTCSeconds() };
}

/** Ancla la parte de fecha de `date` (`@db.Date`, medianoche UTC "de mentira") con la
 * hora de pared de `time` y recién ahí suma el offset de Argentina — mismo criterio
 * que `combineDateAndTime`/`toRealInstant` de `shipments.service.ts`, pero operando
 * sobre valores ya persistidos (o el string crudo de una franja propuesta, MOVO-234)
 * en vez de parsear strings del body de un request. */
function anchorTimeOfDayToInstant(date: Date, time: Date | string): Date {
  const { hours, minutes, seconds } = timeOfDay(time);
  const anchored = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes, seconds);
  return new Date(anchored + ARGENTINA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

/**
 * Instante real (UTC) en el que cierra la ventana de retiro de un envío, a partir de
 * los valores tal como los devuelve Prisma (`Shipment.pickupDate` @db.Date,
 * `Shipment.pickupTimeWindowEnd` @db.Time) — cada uno anclado por separado (reloj de
 * pared argentino etiquetado como UTC, ver el fix de timezone de MOVO-80/MOVO-130),
 * nunca instantes reales. Combina la parte de fecha de uno con la parte de hora del
 * otro (ambos ya en UTC "de mentira") y recién ahí suma el offset de Argentina —
 * mismo criterio que `combineDateAndTime`/`toRealInstant` de `shipments.service.ts`,
 * pero esta versión opera sobre los `Date` ya persistidos en vez de parsear strings
 * del body de un request, para el barrido de expiración de envíos `published`
 * (MOVO-142+, sin ticket propio — corrección directa sobre un bug reportado).
 */
export function pickupWindowEndInstant(pickupDate: Date, pickupTimeWindowEnd: Date): Date {
  return anchorTimeOfDayToInstant(pickupDate, pickupTimeWindowEnd);
}

/**
 * MOVO-234: instante real (UTC) del INICIO de la ventana de retiro EFECTIVAMENTE
 * acordada de un envío al aceptar una oferta -- simétrica a `pickupWindowEndInstant`,
 * pero para el arranque (usada como `departureAt` del `Trip` auto-creado cuando la
 * oferta aceptada no venía asociada a un viaje declarado,
 * `offer-repository.ts#acceptOffer`). `offeredDate` es siempre la fecha de retiro
 * EFECTIVA (MOVO-177: el transportista pudo haber propuesto un día distinto al
 * pedido por el emisor, y `offeredDate` ya refleja eso). La franja horaria también
 * prioriza lo que el transportista propuso (`offeredPickupTimeWindowStart`, string
 * "HH:MM:SS" sin anclar, `null` si no propuso una distinta) sobre la original del
 * envío (`shipmentPickupTimeWindowStart`, `Date` @db.Time ya anclada).
 */
export function acceptedOfferPickupWindowStartInstant(
  offeredDate: Date,
  offeredPickupTimeWindowStart: string | null,
  shipmentPickupTimeWindowStart: Date,
): Date {
  return anchorTimeOfDayToInstant(offeredDate, offeredPickupTimeWindowStart ?? shipmentPickupTimeWindowStart);
}

/**
 * `true` si la ventana de retiro de un envío ya cerró respecto de `now`. Usado por el
 * barrido (`shipments.service.ts#expireOverduePublishedShipments`) que cancela los
 * `published` que nadie retiró a tiempo -- `GET /shipments/available` en sí NO filtra
 * en tiempo real por esto (mismo motivo que el resto del dominio prefiere funciones
 * puras en JS a replicar esta cuenta en SQL, ver el comentario de
 * `findPotentiallyExpiredPublished` en `shipment-repository.ts`): sigue devolviendo
 * `published` con la ventana recién vencida hasta que corre el próximo barrido (a lo
 * sumo `PICKUP_EXPIRY_SWEEP_INTERVAL_MINUTES`). El mobile (MOVO-148) aplica el mismo
 * chequeo client-side sobre la lista ya paginada para no depender de esa ventana.
 */
export function isPickupWindowExpired(pickupDate: Date, pickupTimeWindowEnd: Date, now: Date = new Date()): boolean {
  return pickupWindowEndInstant(pickupDate, pickupTimeWindowEnd) < now;
}

/**
 * Inversa de `pickupWindowEndInstant`: dado un instante real (UTC, ej.
 * `Trip.departureAt`), la fecha de calendario en Argentina como un `Date` anclado
 * (Y/M/D en UTC a medianoche) -- mismo formato "reloj de pared etiquetado como UTC"
 * que `Shipment.pickupDate` (`@db.Date`), para poder comparar ambos directamente en
 * SQL con una simple igualdad de columna `date`. Usado por el matching envío↔viaje
 * (`trips.service.ts#getTripMatches`, bug encontrado en producción -- MOVO-163 nunca
 * filtraba por fecha, solo por geografía).
 *
 * El cálculo del día calendario en sí vive en `@movo/shared#toArgentinaCalendarDateString`
 * (compartido con `movo-mobile`, que necesita la misma cuenta client-side para la
 * franja "de paso" del tab Transportar) -- acá solo se envuelve en el `Date` anclado
 * que el resto de este dominio espera para comparar contra columnas `@db.Date`.
 */
export function toArgentinaCalendarDate(instant: Date): Date {
  const [year, month, day] = toArgentinaCalendarDateString(instant).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
