/**
 * MOVO-245: "Horario de silencio" -- franja horaria (hora Argentina, `"HH:MM"` 24hs,
 * ver `toArgentinaTimeOfDayString`) en la que `svc-users` no envía push, salvo
 * categorías marcadas `quietHoursExempt` (`config/notification-categories.ts`).
 * Función pura, sin acceso a reloj/DB, para poder testear los bordes (medianoche,
 * franja invertida) sin mockear tiempo real.
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeOfDay(value: string): boolean {
  return TIME_PATTERN.test(value);
}

function toMinutes(hhmm: string): number {
  const hours = Number(hhmm.slice(0, 2));
  const minutes = Number(hhmm.slice(3, 5));
  return hours * 60 + minutes;
}

/**
 * `from`/`to` pueden cruzar medianoche (ej. "23:00" a "08:00", el caso normal de un
 * horario de silencio nocturno) -- se resuelve comparando en minutos-desde-medianoche
 * con wraparound, no con un simple `from <= now <= to`. `from === to` se interpreta
 * como "silencio las 24hs" (franja de largo cero no tiene un caso de uso real, pero
 * negarlo en vez de definirlo evita un bug de UI si el usuario deja "Desde"/"Hasta"
 * en el mismo valor).
 */
export function isWithinQuietHours(nowHHMM: string, fromHHMM: string, toHHMM: string): boolean {
  const now = toMinutes(nowHHMM);
  const from = toMinutes(fromHHMM);
  const to = toMinutes(toHHMM);

  if (from === to) return true;
  if (from < to) {
    // Franja normal dentro del mismo día calendario (ej. "13:00" a "15:00").
    return now >= from && now < to;
  }
  // Cruza medianoche (ej. "23:00" a "08:00").
  return now >= from || now < to;
}
