import { toArgentinaCalendarDateString } from "@movo/shared";

/** MOVO-240: el recordatorio sale desde las 19:00 (hora argentina) del día anterior a la
 * salida. Se descartó "24 h antes de `departureAt`": puede caer de madrugada. */
export const TRIP_DEPARTURE_REMINDER_HOUR_AR = 19;

const DAY_MS = 24 * 60 * 60 * 1000;

function argentinaTimeOfDay(date: string, hour: number): Date {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00-03:00`);
}

export interface DepartureReminderWindow {
  /** Inicio (inclusive) y fin (exclusivo) del día calendario argentino de mañana. */
  departureFrom: Date;
  departureTo: Date;
  /** Inicio del día calendario argentino de hoy: solo se recuerda un viaje declarado antes del
   * día anterior a su salida. Quien lo declara hoy para mañana lo tiene presente (review de PR
   * #233; con el corte en las 19:00, declarar a las 18:55 traía el aviso cinco minutos después). */
  createdBefore: Date;
}

/**
 * Ventana del recordatorio para el instante `now`, o `null` si en Argentina todavía no
 * son las 19:00. El barrido corre cada pocos minutos y, a partir de las 19:00, cubre los
 * viajes que salen mañana; el claim en Redis evita repetir el aviso en cada vuelta.
 */
export function departureReminderWindow(now: Date): DepartureReminderWindow | null {
  const today = toArgentinaCalendarDateString(now);
  const reminderStart = argentinaTimeOfDay(today, TRIP_DEPARTURE_REMINDER_HOUR_AR);
  if (now.getTime() < reminderStart.getTime()) return null;

  const todayStart = argentinaTimeOfDay(today, 0);
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
  return {
    departureFrom: tomorrowStart,
    departureTo: new Date(tomorrowStart.getTime() + DAY_MS),
    createdBefore: todayStart,
  };
}
