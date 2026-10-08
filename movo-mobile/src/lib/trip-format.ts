import { ApiError } from "@movo/shared/dist/errors/api-error";
import { TripStatus } from "../api/trips-client";
import { friendlyErrorMessage } from "./error-messages";

// MOVO-262 AC2: labels legibles del estado del viaje.
const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  [TripStatus.DECLARED]: "Declarado",
  [TripStatus.ACTIVE]: "En curso",
  [TripStatus.COMPLETED]: "Completado",
  [TripStatus.CANCELLED]: "Cancelado",
  [TripStatus.EXPIRED]: "Venció",
};

export function tripStatusLabel(status: TripStatus): string {
  return TRIP_STATUS_LABELS[status];
}

/**
 * `lime` = declarado (lime-200 + ink-950); `dark` = en curso (ink-950 + texto lima-400 +
 * punto lima animado, ver `TripCard`). El resto son los tonos semánticos de siempre.
 */
export type TripStatusTone = "lime" | "dark" | "success" | "danger" | "neutral";

export function tripStatusTone(status: TripStatus): TripStatusTone {
  switch (status) {
    case TripStatus.DECLARED:
      return "lime";
    case TripStatus.ACTIVE:
      return "dark";
    case TripStatus.COMPLETED:
      return "success";
    case TripStatus.CANCELLED:
      return "danger";
    case TripStatus.EXPIRED:
    default:
      return "neutral";
  }
}

const DEPARTURE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** `departureAt` viaja como ISO datetime completo (`Trip` en `trips-client.ts`) — sin
 * el gotcha de timezone de `pickupDate` (ver CLAUDE.md de `svc-shipments`/MOVO-80), se
 * lee en hora local del dispositivo directo con `new Date`. */
export function formatDepartureLabel(departureAt: string): string {
  return DEPARTURE_FORMATTER.format(new Date(departureAt));
}

const DEPARTURE_DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
});

export function formatDepartureDateOnly(departureAt: string): string {
  try {
    return DEPARTURE_DATE_FORMATTER.format(new Date(departureAt));
  } catch {
    return departureAt;
  }
}

export function isTripDepartureToday(departureAt: string): boolean {
  try {
    const d = new Date(departureAt);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  } catch {
    return false;
  }
}

/**
 * MOVO-252: Formatea el error devuelto al intentar iniciar un viaje (`POST /trips/:id/start`).
 * AC6: Si es 409 por límite de un viaje activo: "Ya tenés otro viaje en curso. Solo podés tener 1 viaje activo a la vez."
 * AC4: Si es genérico o de red: mensaje amigable sin alterar el estado del viaje.
 */
export function formatTripStartErrorMessage(err: unknown, departureAt?: string): string {
  if (err instanceof ApiError) {
    if (err.code === "TRIP_ALREADY_HAS_ACTIVE_TRIP") {
      return "Ya tenés otro viaje en curso. Solo podés tener 1 viaje activo a la vez.";
    }
    if (err.code === "TRIP_NOT_DECLARED") {
      return "El viaje ya fue iniciado o finalizado.";
    }
  }
  return friendlyErrorMessage(err, "No pudimos iniciar el viaje. Intentá de nuevo.");
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("es-AR", { weekday: "short" });
const MONTH_SHORT_FORMATTER = new Intl.DateTimeFormat("es-AR", { month: "short" });
const DAY_FORMATTER = new Intl.DateTimeFormat("es-AR", { day: "numeric" });
const TIME_FORMATTER = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
const MONTH_LONG_FORMATTER = new Intl.DateTimeFormat("es-AR", { month: "long" });
const YEAR_FORMATTER = new Intl.DateTimeFormat("es-AR", { year: "numeric" });

/** "sept." / "sep." / "sept" → "sep" (el mockup usa siempre tres letras). */
function shortMonth(d: Date): string {
  return MONTH_SHORT_FORMATTER.format(d).replace(".", "").slice(0, 3).toLowerCase();
}
function shortWeekday(d: Date): string {
  return WEEKDAY_FORMATTER.format(d).replace(".", "").slice(0, 3).toLowerCase();
}

/**
 * Partes del talón de la card de "Mis viajes" (mockup MOVO-262): `HOY`/`VIE`, día, `OCT` y
 * hora `08:00`. `HOY` reemplaza al día de la semana cuando la salida es hoy.
 */
export function tripStubParts(departureAt: string): { dow: string; day: string; mon: string; time: string } {
  const d = new Date(departureAt);
  return {
    dow: isTripDepartureToday(departureAt) ? "HOY" : shortWeekday(d).toUpperCase(),
    day: DAY_FORMATTER.format(d),
    mon: shortMonth(d).toUpperCase(),
    time: TIME_FORMATTER.format(d),
  };
}

/** "sáb 26 sep" — fecha de salida en la card del historial. */
export function tripHistoryDate(departureAt: string): string {
  const d = new Date(departureAt);
  return `${shortWeekday(d)} ${DAY_FORMATTER.format(d)} ${shortMonth(d)}`;
}

/**
 * MOVO-262 AC4: subtexto de una card del historial según su estado. `null` para estados
 * que no son de historial (declared/active).
 */
export function tripHistorySubtext(trip: {
  status: TripStatus;
  acceptedPackagesCount: number;
  cancelledAt: string | null;
}): string | null {
  switch (trip.status) {
    case TripStatus.COMPLETED:
      // Se muestra como chip (`tripDeliveredChipLabel`), no como línea de texto.
      return null;
    case TripStatus.EXPIRED:
      return "Sin paquetes aceptados";
    case TripStatus.CANCELLED: {
      if (!trip.cancelledAt) return "Lo cancelaste";
      const d = new Date(trip.cancelledAt);
      return `Lo cancelaste el ${DAY_FORMATTER.format(d)} ${shortMonth(d)}`;
    }
    default:
      return null;
  }
}

/** Chip del historial para un viaje completado: "3 paquetes entregados". */
export function tripDeliveredChipLabel(count: number): string {
  return `${count} ${count === 1 ? "paquete entregado" : "paquetes entregados"}`;
}

/** Encabezado de mes para agrupar el historial ("Septiembre 2026"), por `departureAt`. */
export function tripMonthLabel(departureAt: string): string {
  const d = new Date(departureAt);
  const month = MONTH_LONG_FORMATTER.format(d);
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${YEAR_FORMATTER.format(d)}`;
}

/** Agrupa preservando el orden recibido (el backend ya ordena el historial). */
export function groupTripsByMonth<T extends { departureAt: string }>(
  trips: T[],
): { label: string; trips: T[] }[] {
  const groups: { label: string; trips: T[] }[] = [];
  for (const trip of trips) {
    const label = tripMonthLabel(trip.departureAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.trips.push(trip);
    else groups.push({ label, trips: [trip] });
  }
  return groups;
}
