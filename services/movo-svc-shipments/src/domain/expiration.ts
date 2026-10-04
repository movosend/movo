import { anchorTimeOfDayToInstant, pickupWindowEndInstant } from "./pickup-window";

/**
 * MOVO-258: reglas puras de vencimiento de envíos ya asignados, sin DB ni reloj propio
 * (`now` siempre lo pasa el caller), mismo criterio que `pickup-window.ts`.
 */

/** D4: el envío se considera anómalo pasada su entrega estimada MÁS este porcentaje de la
 * duración estimada del viaje (retiro -> entrega estimada). */
export const TRANSIT_ANOMALY_EXTRA_RATIO = 0.5;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Instante real desde el cual un envío con transportista asignado (`assignment_pending`/
 * `assigned_unfunded`/`assigned`) cuenta como "retiro no realizado" (D1): cierre de la
 * ventana de retiro EFECTIVA -- desde D3 `acceptOffer` ya copia la acordada al envío,
 * así que alcanza con leer el envío -- más el margen de gracia, por si el retiro se hizo
 * tarde y el handshake llega después.
 */
export function pickupMissedInstant(pickupDate: Date, pickupTimeWindowEnd: Date, graceHours: number): Date {
  return new Date(pickupWindowEndInstant(pickupDate, pickupTimeWindowEnd).getTime() + graceHours * HOUR_MS);
}

export function isPickupMissed(
  pickupDate: Date,
  pickupTimeWindowEnd: Date,
  graceHours: number,
  now: Date = new Date(),
): boolean {
  return pickupMissedInstant(pickupDate, pickupTimeWindowEnd, graceHours) < now;
}

export interface TransitAnomalyInput {
  /** Cuándo pasó a `in_transit` (retiro confirmado): `lastStatusChangedAt`. */
  inTransitSince: Date;
  estimatedDeliveryDate: Date | null;
  /** "HH:MM[:SS]" -- fin de la franja de entrega estimada; si falta, se usa el inicio y,
   * si tampoco, el cierre del día. */
  estimatedDeliveryTimeWindowStart: string | null;
  estimatedDeliveryTimeWindowEnd: string | null;
  /** Plazo fijo desde `inTransitSince` para envíos cuya oferta nunca declaró entrega
   * estimada (es opcional en la oferta, MOVO-180). */
  fallbackHours: number;
}

/**
 * D4: instante a partir del cual un `in_transit` se considera anómalo. Con entrega
 * estimada: `entregaEstimada + 50% * (entregaEstimada - retiro)`; sin ella: un tope fijo
 * desde el retiro. La duración nunca es negativa (una estimada anterior al retiro real
 * no achica el plazo por debajo de la propia estimada).
 */
export function transitAnomalyInstant(input: TransitAnomalyInput): Date {
  if (input.estimatedDeliveryDate === null) {
    return new Date(input.inTransitSince.getTime() + input.fallbackHours * HOUR_MS);
  }
  const estimatedEnd = anchorTimeOfDayToInstant(
    input.estimatedDeliveryDate,
    input.estimatedDeliveryTimeWindowEnd ?? input.estimatedDeliveryTimeWindowStart ?? "23:59:59",
  );
  const durationMs = Math.max(0, estimatedEnd.getTime() - input.inTransitSince.getTime());
  return new Date(estimatedEnd.getTime() + durationMs * TRANSIT_ANOMALY_EXTRA_RATIO);
}

export function isTransitAnomalous(input: TransitAnomalyInput, now: Date = new Date()): boolean {
  return transitAnomalyInstant(input) < now;
}
