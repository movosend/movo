import {
  ARGENTINA_UTC_OFFSET_HOURS,
  toArgentinaCalendarDateString,
} from "@movo/shared/dist/utils/argentina-date";

export interface PickupTimeWindow {
  start: string;
  end: string;
}

/** Franjas de retiro que ofrece el wizard de envío (MOVO-83). */
export const PICKUP_TIME_WINDOWS: readonly PickupTimeWindow[] = [
  { start: "09:00", end: "12:00" },
  { start: "12:00", end: "18:00" },
  { start: "18:00", end: "22:00" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Hoy en Argentina como `"YYYY-MM-DD"`, sin importar la zona horaria del dispositivo
 * (entre las 21:00 y las 00:00, el día UTC ya es el siguiente). */
export function todayInArgentina(now: Date = new Date()): string {
  return toArgentinaCalendarDateString(now);
}

/** Instante real en que empieza una hora `"HH:MM"` de un día `"YYYY-MM-DD"` argentino. */
function argentinaInstant(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours + ARGENTINA_UTC_OFFSET_HOURS, minutes));
}

/**
 * MOVO-340: las franjas de `date` que todavía se pueden elegir — misma regla que el backend
 * (`SHIPMENT_PICKUP_WINDOW_IN_PAST`, `shipments.service.ts`): el inicio de la franja no
 * puede haber pasado. Un día anterior a hoy no tiene ninguna.
 */
export function availableWindowsFor(date: string, now: Date = new Date()): PickupTimeWindow[] {
  if (!DATE_PATTERN.test(date)) return [];
  return PICKUP_TIME_WINDOWS.filter((w) => argentinaInstant(date, w.start) >= now);
}

/** MOVO-340: fecha con la que arranca el wizard — hoy si todavía queda alguna franja,
 * si no mañana. Así el día que se ve elegido nunca es uno que la validación rechaza. */
export function defaultPickupDate(now: Date = new Date()): string {
  const today = todayInArgentina(now);
  if (availableWindowsFor(today, now).length > 0) return today;
  return toArgentinaCalendarDateString(new Date(now.getTime() + DAY_MS));
}

/** Convierte el `"YYYY-MM-DD"` del formulario al `Date` local que espera el selector
 * nativo (medianoche del dispositivo de ese día calendario), y viceversa. */
export function pickupDateToPickerValue(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function pickerValueToPickupDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
