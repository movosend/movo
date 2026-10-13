import { toArgentinaCalendarDateString } from "@movo/shared";

/** MOVO-240: el recordatorio sale desde las 19:00 (hora argentina) del día anterior a la
 * salida. Se descartó "24 h antes de `departureAt`": puede caer de madrugada. */
export const TRIP_DEPARTURE_REMINDER_HOUR_AR = 19;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DepartureReminderWindow {
  /** Inicio (inclusive) y fin (exclusivo) del día calendario argentino de mañana. */
  departureFrom: Date;
  departureTo: Date;
  /** Las 19:00 de hoy: un viaje declarado más tarde ya se sabe que sale mañana y no se
   * le avisa (decisión del refinamiento). */
  createdBefore: Date;
}

/**
 * Ventana del recordatorio para el instante `now`, o `null` si en Argentina todavía no
 * son las 19:00. El barrido corre cada pocos minutos y, a partir de las 19:00, cubre los
 * viajes que salen mañana; el claim en Redis evita repetir el aviso en cada vuelta.
 */
export function departureReminderWindow(now: Date): DepartureReminderWindow | null {
  const today = toArgentinaCalendarDateString(now);
  const reminderStart = new Date(`${today}T${String(TRIP_DEPARTURE_REMINDER_HOUR_AR).padStart(2, "0")}:00:00-03:00`);
  if (now.getTime() < reminderStart.getTime()) return null;

  const tomorrowStart = new Date(new Date(`${today}T00:00:00-03:00`).getTime() + DAY_MS);
  return {
    departureFrom: tomorrowStart,
    departureTo: new Date(tomorrowStart.getTime() + DAY_MS),
    createdBefore: reminderStart,
  };
}
