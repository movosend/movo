// La app opera solo en Argentina — sin DST, por lo que el offset es constante.
const ARGENTINA_UTC_OFFSET_HOURS = 3;

/**
 * Día calendario en Argentina para un instante real, como string `"YYYY-MM-DD"` —
 * formato comparable directamente contra cualquier valor de fecha-sin-hora del
 * dominio (`Shipment.pickupDate`, wire format `pickupDate` del mobile, etc.). Único
 * lugar donde vive esta cuenta (offset fijo UTC-3): antes duplicada por separado en
 * `movo-svc-shipments` (`domain/pickup-window.ts#toArgentinaCalendarDate`, que la usa
 * para el matching envío↔viaje de `GET /trips/:id/matches` y reconstruye un `Date`
 * anclado a partir de este string para comparar en SQL contra columnas `@db.Date`) y
 * en `movo-mobile` (`shipment-format.ts#computeOnTripDetour`, franja "de paso" del
 * tab Transportar) — ambos consumen esta única implementación ahora.
 */
export function toArgentinaCalendarDateString(instant: Date | string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const local = new Date(date.getTime() - ARGENTINA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
