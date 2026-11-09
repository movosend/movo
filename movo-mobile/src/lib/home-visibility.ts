import { ShipmentStatus } from "@movo/shared/dist/types/shipment";

/**
 * Cuánto se queda en Inicio un envío que ya no avanza: el día en que pasó y el siguiente,
 * en días calendario argentinos (no 48 h corridas). Después de eso se ve en "Mis envíos", no en las
 * cards de Inicio. Aplica a dos casos:
 * - un envío cerrado sin completarse (`cancelled`, vencido, rechazado): cuenta desde el cierre;
 * - un envío con la ventana de retiro vencida que todavía no se cerró (p.ej. el barrido no
 *   pudo liberar el hold): cuenta desde el día de retiro.
 * `completed`/`delivered` no expiran: son el fallback de "Actividad reciente".
 */

/** Estados en los que el paquete todavía no se retiró: una fecha de retiro pasada lo deja vencido. */
const PRE_PICKUP_STATUSES: readonly string[] = [
  ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
  ShipmentStatus.REJECTED_BY_RECEIVER,
  ShipmentStatus.PUBLISHED,
  ShipmentStatus.ASSIGNMENT_PENDING,
  ShipmentStatus.ASSIGNED_UNFUNDED,
  ShipmentStatus.ASSIGNED,
];

/** Argentina no tiene horario de verano desde 2009: offset fijo, como `account-restriction.ts` (Hermes no respeta
 * `timeZone` en `Intl`). El backend corta los días en hora argentina (`toArgentinaCalendarDate`): con el calendario del
 * dispositivo, fuera del país el corte se corría un día. */
const ARGENTINA_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Número de día calendario argentino de un instante. */
function argentinaDay(date: Date): number {
  return Math.floor((date.getTime() + ARGENTINA_OFFSET_MS) / DAY_MS);
}

/** `true` si `date` cae hoy o ayer, en el calendario argentino. */
export function isTodayOrYesterday(date: Date, now: Date = new Date()): boolean {
  if (Number.isNaN(date.getTime())) return true;
  const day = argentinaDay(date);
  const today = argentinaDay(now);
  return day >= today - 1 && day <= today;
}

/** `"YYYY-MM-DD"` (wire format de `pickupDate`, ya en calendario argentino) como número de día. */
function pickupDay(pickupDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return null;
  const [year, month, day] = pickupDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** `true` si el retiro fue antes de ayer: pasado el día siguiente, el envío vencido sale de Inicio. */
export function isPickupDayBeforeYesterday(pickupDate: string, now: Date = new Date()): boolean {
  const day = pickupDay(pickupDate);
  if (day === null) return false;
  return day < argentinaDay(now) - 1;
}

/**
 * Card de "Estoy enviando"/"Voy a recibir": la oculta si la ventana venció antes de ayer. Como en "Actividad reciente"
 * (`selectRecentShipments`), lo que le pide una acción a quien mira no sale: al emisor, un `assigned_unfunded` le pide
 * el pago. Al receptor no le pide nada.
 */
export function isStaleActiveShipment(
  shipment: { pickupWindowExpired: boolean; pickupDate: string; status?: string },
  now: Date = new Date(),
  viewer: "sender" | "receiver" = "receiver",
): boolean {
  if (viewer === "sender" && shipment.status === ShipmentStatus.ASSIGNED_UNFUNDED) return false;
  return shipment.pickupWindowExpired && isPickupDayBeforeYesterday(shipment.pickupDate, now);
}

/** Envío todavía abierto pero sin retirar y con el día de retiro antes de ayer. */
export function isStalePrePickupShipment(
  shipment: { status: string; pickupDate: string },
  now: Date = new Date(),
): boolean {
  return PRE_PICKUP_STATUSES.includes(shipment.status) && isPickupDayBeforeYesterday(shipment.pickupDate, now);
}
