/**
 * MOVO-340: formateo único de horas y duraciones de la app. Convención (símbolo del SI y de
 * la RAE, "h" y no "hs"):
 * - hora del día: `14:30 h`
 * - duración: `45 min`, `2 h`, `2 h 15 min`
 * - rango horario: `14:00 a 16:00 h`
 *
 * Las horas de un instante (`Date`) se muestran en la zona del dispositivo, como el resto de
 * la app: Hermes no respeta `timeZone` en `Intl` (ver `account-restriction.ts`). Las horas
 * que ya vienen como `"HH:MM[:SS]"` (franjas de retiro, en hora argentina) se muestran tal cual.
 */

const TIME_PATTERN = /^(\d{1,2}):(\d{2})/;

/** `"9:00:00"` → `"09:00"`, sin unidad: para comparar franjas o completar un campo. `""` si no es una hora. */
export function toHHMM(time: string | null | undefined): string {
  if (!time) return "";
  const match = TIME_PATTERN.exec(time);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

/** Hora de reloj de un instante en la zona del dispositivo (`"14:30"`), sin unidad. */
export function clockTime(instant: Date): string {
  return `${String(instant.getHours()).padStart(2, "0")}:${String(instant.getMinutes()).padStart(2, "0")}`;
}

/** Un `Date`, un ISO datetime (`"2026-10-24T17:30:00Z"`, se muestra en la hora del dispositivo) o una hora `"HH:MM[:SS]"`. */
export type TimeValue = string | Date | null | undefined;

function toClock(value: TimeValue): string {
  if (typeof value === "string" && value.includes("T")) value = new Date(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : clockTime(value);
  return toHHMM(value);
}

/** Hora del día con unidad: `"14:30 h"`. `""` si el valor no es una hora válida. */
export function formatTimeOfDay(value: TimeValue): string {
  const clock = toClock(value);
  return clock ? `${clock} h` : "";
}

/** Rango horario con una sola unidad al final: `"14:00 a 16:00 h"`. Un extremo inválido se muestra como `—`. */
export function formatTimeRange(start: TimeValue, end: TimeValue): string {
  const s = toClock(start);
  const e = toClock(end);
  if (!s && !e) return "";
  return `${s || "—"} a ${e || "—"} h`;
}

/** Duración en minutos: `"45 min"`, `"2 h"`, `"2 h 15 min"`. Nunca pasa a días (`"26 h"`); un negativo es `"0 min"`. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Igual que `formatDuration`, a partir de segundos (rutas de Google, redondeado al minuto). */
export function formatDurationSeconds(seconds: number): string {
  return formatDuration(seconds / 60);
}

/**
 * Tiempo transcurrido o restante para frases relativas ("hace 5 min", "quedan 2 h"): en
 * minutos hasta la hora y en horas enteras después, sin sumar minutos (`"3 h"`, no
 * `"3 h 12 min"`), porque en esas frases el detalle no aporta.
 */
export function formatRelativeDuration(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  return total < 60 ? `${total} min` : `${Math.floor(total / 60)} h`;
}
