import { toArgentinaCalendarDateString } from "../utils/argentina-date";

/**
 * MOVO-265 (ADR-042): convención de días de `Trip.recurrenceWeekdays`. `0 = domingo …
 * 6 = sábado`, igual que `Date#getDay()` de JS y `EXTRACT(DOW)` de Postgres. El mobile
 * ordena los chips arrancando en lunes, pero el valor de cada chip sale de esta tabla,
 * nunca de su posición.
 */
export const RECURRENCE_WEEKDAY = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
} as const;

/** ADR-042 (punto 9): series activas (trip vigente con `recurrenceWeekdays` no nulo) por transportista. */
export const MAX_ACTIVE_RECURRING_SERIES = 3;

// Mismo offset fijo que `utils/argentina-date.ts` (Argentina no tiene DST).
const ARGENTINA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SHORT_WEEKDAY_NAMES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;

/** Día de la semana (convención `RECURRENCE_WEEKDAY`) de un instante, en huso argentino. */
export function argentinaWeekday(instant: Date | string): number {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  return new Date(date.getTime() - ARGENTINA_UTC_OFFSET_MS).getUTCDay();
}

/** `"vie 10/10"`: día de la semana abreviado y día/mes en huso argentino, para pushes y la UI. */
export function formatArgentinaShortDay(instant: Date | string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const local = new Date(date.getTime() - ARGENTINA_UTC_OFFSET_MS);
  return `${SHORT_WEEKDAY_NAMES[local.getUTCDay()]} ${local.getUTCDate()}/${local.getUTCMonth() + 1}`;
}

/**
 * MOVO-265 (ADR-042, punto 5): fecha de la ocurrencia que sigue a un trip recurrente.
 * Es el próximo día de `weekdays` ESTRICTAMENTE posterior a `max(departureAt, now)`, a la
 * misma hora de pared que `departureAt` en huso argentino. Tomar el máximo con `now` evita
 * generar ocurrencias que nacen vencidas si el barrido estuvo caído varios días.
 *
 * `until` (`"YYYY-MM-DD"`, inclusive, calendario argentino) corta la serie: si la próxima
 * fecha cae después, devuelve `null`. También devuelve `null` si `weekdays` está vacío.
 */
export function nextRecurrenceOccurrence(params: {
  departureAt: Date;
  weekdays: readonly number[];
  until: string | null;
  now: Date;
}): Date | null {
  const { departureAt, weekdays, until, now } = params;
  if (weekdays.length === 0) return null;

  const localDepartureMs = departureAt.getTime() - ARGENTINA_UTC_OFFSET_MS;
  const wallTimeMs = ((localDepartureMs % DAY_MS) + DAY_MS) % DAY_MS;

  const base = Math.max(departureAt.getTime(), now.getTime());
  const localBaseMs = base - ARGENTINA_UTC_OFFSET_MS;
  const baseDayStartMs = localBaseMs - (((localBaseMs % DAY_MS) + DAY_MS) % DAY_MS);

  // A lo sumo 8 vueltas: el día 7 repite el día de semana del 0 y siempre queda después de `base`.
  for (let offset = 0; offset <= 7; offset++) {
    const dayStartMs = baseDayStartMs + offset * DAY_MS;
    if (!weekdays.includes(new Date(dayStartMs).getUTCDay())) continue;
    const candidate = dayStartMs + wallTimeMs + ARGENTINA_UTC_OFFSET_MS;
    if (candidate <= base) continue;
    const next = new Date(candidate);
    if (until !== null && toArgentinaCalendarDateString(next) > until) return null;
    return next;
  }
  return null;
}
