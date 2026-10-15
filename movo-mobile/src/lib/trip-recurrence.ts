import { toArgentinaCalendarDateString, toArgentinaTimeOfDayString } from "@movo/shared/dist/utils/argentina-date";
import type { Trip } from "../api/trips-client";
import { shortAddressLabel } from "./shipment-format";
import {
  RECURRENCE_WEEKDAY,
  formatArgentinaShortDay,
  nextRecurrenceOccurrence,
} from "@movo/shared/dist/config/trip-recurrence";

/**
 * Chips de días del bloque "Se repite" (MOVO-266). Arrancan en lunes, pero el valor de
 * cada uno sale de `RECURRENCE_WEEKDAY` (0 = domingo), nunca de su posición.
 */
export const WEEKDAY_CHIPS = [
  { value: RECURRENCE_WEEKDAY.MONDAY, label: "L", name: "lunes" },
  { value: RECURRENCE_WEEKDAY.TUESDAY, label: "M", name: "martes" },
  { value: RECURRENCE_WEEKDAY.WEDNESDAY, label: "M", name: "miércoles" },
  { value: RECURRENCE_WEEKDAY.THURSDAY, label: "J", name: "jueves" },
  { value: RECURRENCE_WEEKDAY.FRIDAY, label: "V", name: "viernes" },
  { value: RECURRENCE_WEEKDAY.SATURDAY, label: "S", name: "sábado" },
  { value: RECURRENCE_WEEKDAY.SUNDAY, label: "D", name: "domingo" },
] as const;

const SHORT_NAMES: Record<number, string> = {
  [RECURRENCE_WEEKDAY.MONDAY]: "lun",
  [RECURRENCE_WEEKDAY.TUESDAY]: "mar",
  [RECURRENCE_WEEKDAY.WEDNESDAY]: "mié",
  [RECURRENCE_WEEKDAY.THURSDAY]: "jue",
  [RECURRENCE_WEEKDAY.FRIDAY]: "vie",
  [RECURRENCE_WEEKDAY.SATURDAY]: "sáb",
  [RECURRENCE_WEEKDAY.SUNDAY]: "dom",
};

/** Plural de cada día ("los sábados"); lunes a viernes no cambian. */
const PLURAL_NAMES: Record<number, string> = {
  [RECURRENCE_WEEKDAY.MONDAY]: "lunes",
  [RECURRENCE_WEEKDAY.TUESDAY]: "martes",
  [RECURRENCE_WEEKDAY.WEDNESDAY]: "miércoles",
  [RECURRENCE_WEEKDAY.THURSDAY]: "jueves",
  [RECURRENCE_WEEKDAY.FRIDAY]: "viernes",
  [RECURRENCE_WEEKDAY.SATURDAY]: "sábados",
  [RECURRENCE_WEEKDAY.SUNDAY]: "domingos",
};

const CHIP_ORDER: readonly number[] = WEEKDAY_CHIPS.map((chip) => chip.value);

/** Días ordenados de lunes a domingo, sin repetidos. */
export function sortWeekdays(weekdays: readonly number[]): number[] {
  return CHIP_ORDER.filter((day) => weekdays.includes(day));
}

/** Nombre singular del día ("viernes"), para textos como "el viaje de este viernes". */
export function weekdayName(weekday: number): string {
  return WEEKDAY_CHIPS.find((chip) => chip.value === weekday)?.name ?? "";
}

function joinWithY(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Badge de serie: "Todos los viernes", "Lun y vie", "Lun, mié y vie". */
export function formatRecurrenceBadge(weekdays: readonly number[]): string {
  const days = sortWeekdays(weekdays);
  if (days.length === 1) return `Todos los ${PLURAL_NAMES[days[0]]}`;
  return capitalize(joinWithY(days.map((day) => SHORT_NAMES[day])));
}

/** "todos los viernes" con un día, "los lunes y viernes" con varios. */
function daysPhrase(weekdays: readonly number[]): string {
  const days = sortWeekdays(weekdays);
  if (days.length === 1) return `todos los ${PLURAL_NAMES[days[0]]}`;
  return `los ${joinWithY(days.map((day) => PLURAL_NAMES[day]))}`;
}

/**
 * Preview lima del bloque "Se repite". Usa la misma cuenta que el barrido del backend
 * (`nextRecurrenceOccurrence`, `@movo/shared`) para detectar una fecha de fin que no deja
 * declarar ningún viaje más.
 */
export function recurrencePreview(params: {
  departureAt: Date;
  weekdays: readonly number[];
  until: string | null;
}): string {
  const { departureAt, weekdays, until } = params;
  const firstDay = formatArgentinaShortDay(departureAt);
  const next = nextRecurrenceOccurrence({ departureAt, weekdays, until, now: departureAt });
  if (next === null) {
    return `Con esa fecha de fin no declaramos ningún viaje después del ${firstDay}.`;
  }
  return `Cuando salgas el ${firstDay}, declaramos automáticamente tu próximo viaje (${daysPhrase(
    weekdays,
  )} a las ${toArgentinaTimeOfDayString(departureAt)}).`;
}

/**
 * El chip del día de "Desde" es de la fecha, no una elección del usuario: si cambia la
 * fecha, se saca el día fijo anterior y se suma el nuevo (el backend exige que el día de
 * `departureAt` esté incluido).
 */
export function withFixedDay(weekdays: readonly number[], previousFixed: number, nextFixed: number): number[] {
  if (previousFixed === nextFixed) return sortWeekdays([...weekdays, nextFixed]);
  return sortWeekdays([...weekdays.filter((day) => day !== previousFixed), nextFixed]);
}

/** `Date` del picker (calendario del dispositivo) → `"YYYY-MM-DD"` de `recurrenceUntil`. */
export function toUntilDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `"YYYY-MM-DD"` → `Date` local al mediodía (lejos del borde del día para el picker). */
export function fromUntilDateString(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/**
 * `recurrenceUntil` tiene que ser posterior al día de la salida. El backend compara contra el
 * día en huso argentino (`toArgentinaCalendarDateString`), no contra el del dispositivo: en un
 * teléfono con otra zona horaria la salida puede caer en otro día calendario.
 */
export function isUntilAfterDeparture(until: string, departureAt: Date): boolean {
  return until > toArgentinaCalendarDateString(departureAt);
}

/** Primer día que se puede elegir como "Hasta": el siguiente a la salida, en huso argentino. */
export function minimumUntilDate(departureAt: Date): Date {
  const [year, month, day] = toArgentinaCalendarDateString(departureAt).split("-").map(Number);
  return new Date(year, month - 1, day + 1, 12, 0, 0, 0);
}

/**
 * Texto del banner de viajes nuevos (MOVO-236). MOVO-266: distingue las ocurrencias que
 * declaró el barrido de una serie recurrente (`generatedFromTripId`) de los viajes que se
 * armaron al aceptar una oferta.
 */
type NewTrip = Pick<Trip, "departureAt" | "destinationAddress" | "generatedFromTripId">;

export function newTripsBannerMessage(newTrips: readonly NewTrip[]): string | null {
  if (newTrips.length === 0) return null;
  const generated = newTrips.filter((trip) => trip.generatedFromTripId !== null);
  if (generated.length === newTrips.length) {
    if (generated.length === 1) {
      const [trip] = generated;
      return `Declaramos tu viaje del ${formatArgentinaShortDay(trip.departureAt)} a ${shortAddressLabel(
        trip.destinationAddress,
      )}`;
    }
    return "Declaramos tus próximos viajes que se repiten";
  }
  if (generated.length > 0) return "Tenés viajes nuevos en Próximos";
  return newTrips.length === 1
    ? "Se armó un viaje con un envío que aceptaste"
    : "Se armaron viajes nuevos con envíos que aceptaste";
}
