import { ShipmentStatus } from "@movo/shared/dist/types/shipment";

/**
 * Cuánto se queda en Inicio un envío que ya no avanza: el día en que pasó y el siguiente,
 * en días calendario (no 48 h corridas). Después de eso se ve en "Mis envíos", no en las
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

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** `true` si `date` cae hoy o ayer, en el calendario del dispositivo. */
export function isTodayOrYesterday(date: Date, now: Date = new Date()): boolean {
  if (Number.isNaN(date.getTime())) return true;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const day = startOfDay(date);
  return day >= yesterday && day <= startOfDay(now);
}

/** `"YYYY-MM-DD"` (wire format de `pickupDate`) como fecha local, sin correr el día por UTC. */
function pickupDay(pickupDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return null;
  const [year, month, day] = pickupDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** `true` si el retiro fue antes de ayer: pasado el día siguiente, el envío vencido sale de Inicio. */
export function isPickupDayBeforeYesterday(pickupDate: string, now: Date = new Date()): boolean {
  const day = pickupDay(pickupDate);
  if (!day) return false;
  return day.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
}

/** Card de "Estoy enviando"/"Voy a recibir": la oculta si la ventana venció antes de ayer. */
export function isStaleActiveShipment(
  shipment: { pickupWindowExpired: boolean; pickupDate: string },
  now: Date = new Date(),
): boolean {
  return shipment.pickupWindowExpired && isPickupDayBeforeYesterday(shipment.pickupDate, now);
}

/** Envío todavía abierto pero sin retirar y con el día de retiro antes de ayer. */
export function isStalePrePickupShipment(
  shipment: { status: string; pickupDate: string },
  now: Date = new Date(),
): boolean {
  return PRE_PICKUP_STATUSES.includes(shipment.status) && isPickupDayBeforeYesterday(shipment.pickupDate, now);
}
