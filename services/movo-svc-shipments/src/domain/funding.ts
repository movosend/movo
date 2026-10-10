import type { FundingRoute } from "@movo/shared";

/**
 * MOVO-210: reglas puras de la saga de asignación (pago del emisor), sin DB ni reloj propio
 * (`now` siempre lo pasa el caller), mismo criterio que `expiration.ts`/`pickup-window.ts`.
 *
 * `pickupStart` es siempre el INICIO de la ventana de retiro EFECTIVA acordada (la de la
 * oferta aceptada, ver `acceptedOfferPickupWindowStartInstant`): el hold se ancla al
 * momento en que el transportista puede empezar a retirar.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Ruta de la saga. "Dentro de N días" es inclusivo: un retiro exactamente a N días toma la
 * ruta cercana, y a N días más un instante, la lejana.
 */
export function selectFundingRoute(pickupStart: Date, now: Date, nearDays: number): FundingRoute {
  return pickupStart.getTime() - now.getTime() <= nearDays * DAY_MS ? "near" : "far";
}

/** Instante en que se abre la ventana de confirmación de la ruta lejana (retiro entra en N días). */
export function fundingWindowOpensAt(pickupStart: Date, nearDays: number): Date {
  return new Date(pickupStart.getTime() - nearDays * DAY_MS);
}

/** Último instante en que el emisor puede pagar en la ruta lejana: T-24h del retiro. */
export function farRouteFundingDeadline(pickupStart: Date, releaseHoursBeforePickup: number): Date {
  return new Date(pickupStart.getTime() - releaseHoursBeforePickup * HOUR_MS);
}

/**
 * Último instante en que el emisor puede pagar en la ruta cercana: `acceptedAt + timeout`,
 * con tope en el cierre de la ventana de retiro (no tiene sentido pagar un retiro que ya pasó).
 */
export function nearRouteFundingDeadline(acceptedAt: Date, timeoutMinutes: number, pickupEnd: Date): Date {
  const timeoutDeadline = new Date(acceptedAt.getTime() + timeoutMinutes * 60 * 1000);
  return timeoutDeadline <= pickupEnd ? timeoutDeadline : pickupEnd;
}

/** `true` si la ruta lejana ya abrió su ventana de confirmación. */
export function isFundingWindowOpen(pickupStart: Date, nearDays: number, now: Date): boolean {
  return fundingWindowOpensAt(pickupStart, nearDays) <= now;
}

/** Cubeta (entera) del recordatorio: cambia cada `intervalHours`, para deduplicar avisos por barrido. */
export function reminderBucket(now: Date, intervalHours: number): number {
  return Math.floor(now.getTime() / (Math.max(1, intervalHours) * HOUR_MS));
}
