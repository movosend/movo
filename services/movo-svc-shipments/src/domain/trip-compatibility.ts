import { toArgentinaCalendarDateString } from "@movo/shared";
import { distanceToSegmentKm } from "./geo";

/**
 * MOVO-314 y DD-060: regla única de compatibilidad de FECHA entre la salida de un viaje y el
 * retiro de un envío: el mismo día calendario argentino, a cualquier hora. La comparten la
 * reutilización de viajes al aceptar una oferta (`offer-repository.ts#acceptOffer`) y la
 * búsqueda de viajes para un envío. El feed de recomendados aplica lo mismo en SQL, con
 * `pickup_date` (`trips.service.ts#getTripMatches`).
 */
export function tripDepartureOnPickupDay(departureAt: Date, pickupStart: Date): boolean {
  return toArgentinaCalendarDateString(departureAt) === toArgentinaCalendarDateString(pickupStart);
}

export interface ReusableTripCandidate {
  id: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  departureAt: Date;
}

export interface ReuseShipmentPoints {
  pickupLat: number;
  pickupLng: number;
  deliveryLat: number;
  deliveryLng: number;
}

/**
 * Elige el viaje al que se suma el envío: retiro y entrega a `maxDetourKm` o menos del
 * corredor origen→destino (mismo criterio que el feed de matches, MOVO-179) y salida
 * el día del retiro (`tripDepartureOnPickupDay`). Entre varios
 * gana el de menor desvío total; el desempate es la salida más cercana al inicio de la
 * ventana. `null` si ninguno califica (se auto-crea uno nuevo).
 */
export function pickReusableTrip(
  candidates: ReusableTripCandidate[],
  shipment: ReuseShipmentPoints,
  pickupWindow: { start: Date; end: Date },
  maxDetourKm: number,
): ReusableTripCandidate | null {
  let best: { trip: ReusableTripCandidate; detourKm: number; gapMs: number } | null = null;

  for (const trip of candidates) {
    if (!tripDepartureOnPickupDay(trip.departureAt, pickupWindow.start)) continue;
    const gapMs = Math.abs(trip.departureAt.getTime() - pickupWindow.start.getTime());

    const pickupKm = distanceToSegmentKm(
      shipment.pickupLat, shipment.pickupLng,
      trip.originLat, trip.originLng, trip.destinationLat, trip.destinationLng,
    );
    const deliveryKm = distanceToSegmentKm(
      shipment.deliveryLat, shipment.deliveryLng,
      trip.originLat, trip.originLng, trip.destinationLat, trip.destinationLng,
    );
    if (pickupKm > maxDetourKm || deliveryKm > maxDetourKm) continue;

    const detourKm = pickupKm + deliveryKm;
    if (!best || detourKm < best.detourKm || (detourKm === best.detourKm && gapMs < best.gapMs)) {
      best = { trip, detourKm, gapMs };
    }
  }
  return best?.trip ?? null;
}
