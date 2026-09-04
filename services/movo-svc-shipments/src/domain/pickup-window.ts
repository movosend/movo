// La app opera solo en Argentina (mismo criterio que `ARGENTINA_UTC_OFFSET_HOURS` en
// `shipments.service.ts`) — sin DST, por lo que el offset es constante.
const ARGENTINA_UTC_OFFSET_HOURS = 3;

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
  const anchored = Date.UTC(
    pickupDate.getUTCFullYear(),
    pickupDate.getUTCMonth(),
    pickupDate.getUTCDate(),
    pickupTimeWindowEnd.getUTCHours(),
    pickupTimeWindowEnd.getUTCMinutes(),
    pickupTimeWindowEnd.getUTCSeconds(),
  );
  return new Date(anchored + ARGENTINA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
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
