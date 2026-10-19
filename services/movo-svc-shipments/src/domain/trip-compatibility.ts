import { toArgentinaCalendarDateString } from "@movo/shared";
import { distanceToSegmentKm } from "./geo";

/**
 * MOVO-314: regla única de compatibilidad de FECHA entre la salida de un viaje y la
 * ventana de retiro de un envío. La comparten el feed de recomendados del viaje
 * (`trips.service.ts#getTripMatches` -> `shipment-repository.ts#listAvailable`) y la
 * reutilización de viajes al aceptar una oferta (`offer-repository.ts#acceptOffer`),
 * para que lo que el feed muestra y lo que se acepta no diverjan. Constante y no env
 * var: define QUÉ cuenta como "mismo recorrido", mismo criterio que `demand.ts`.
 *
 * El viaje es compatible si sale a más tardar al cierre de la ventana de retiro (si no,
 * el transportista ya pasó) y no antes de `TRIP_PICKUP_WINDOW_LEAD_HOURS` del inicio (salir
 * mucho antes no sirve para ese retiro), siempre el mismo día calendario argentino.
 */
export const TRIP_PICKUP_WINDOW_LEAD_HOURS = 2;

export function tripDepartureFitsPickupWindow(departureAt: Date, windowStart: Date, windowEnd: Date): boolean {
  if (toArgentinaCalendarDateString(departureAt) !== toArgentinaCalendarDateString(windowStart)) return false;
  const earliest = windowStart.getTime() - TRIP_PICKUP_WINDOW_LEAD_HOURS * 60 * 60 * 1000;
  return departureAt.getTime() >= earliest && departureAt.getTime() <= windowEnd.getTime();
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
 * compatible con la ventana de retiro (`tripDepartureFitsPickupWindow`). Entre varios
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
    if (!tripDepartureFitsPickupWindow(trip.departureAt, pickupWindow.start, pickupWindow.end)) continue;
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
