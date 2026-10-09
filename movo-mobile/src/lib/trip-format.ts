import { ApiError } from "@movo/shared/dist/errors/api-error";
import { canStartTripOn, tripStartAvailableOn } from "@movo/shared/dist/config/trip-start";
import { toArgentinaCalendarDateString } from "@movo/shared/dist/utils/argentina-date";
import { TripStatus, type TripWithAcceptedPackages } from "../api/trips-client";
import { friendlyErrorMessage } from "./error-messages";
import { pickupLocalityLabel, shortAddressLabel } from "./shipment-format";

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

/** MOVO-277: "hoy" en calendario argentino, el mismo que usa el backend para decidir si
 * el viaje se puede iniciar — no la zona horaria del dispositivo. */
export function isTripDepartureToday(departureAt: string, now: Date = new Date()): boolean {
  try {
    return toArgentinaCalendarDateString(departureAt) === toArgentinaCalendarDateString(now);
  } catch {
    return false;
  }
}

const START_DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** MOVO-277: "jueves 15 de octubre", el día (calendario argentino) desde el que se puede
 * iniciar el viaje. Se arma desde el `"YYYY-MM-DD"` como fecha local, así el día no se
 * corre con la zona horaria del dispositivo. */
export function formatTripStartDate(departureAt: string): string {
  const [year, month, day] = tripStartAvailableOn(departureAt).split("-").map(Number);
  return START_DATE_FORMATTER.format(new Date(year, month - 1, day));
}

export type TripStartBlocker = "too_early" | "packages_not_ready";

/**
 * MOVO-277: por qué un viaje `declared` con paquetes todavía no se puede iniciar, o `null`
 * si ya se puede. Misma regla que `POST /trips/:id/start`: la fecha sale del helper
 * compartido (`canStartTripOn`, `@movo/shared`) y los paquetes de
 * `executablePackagesCount`, que calcula el backend — la app no interpreta estados de
 * envío. La fecha va primero: es lo que el transportista no puede cambiar.
 */
export function tripStartBlocker(
  trip: Pick<TripWithAcceptedPackages, "departureAt" | "executablePackagesCount">,
  now: Date = new Date(),
): TripStartBlocker | null {
  if (!canStartTripOn(trip.departureAt, now)) return "too_early";
  if (trip.executablePackagesCount === 0) return "packages_not_ready";
  return null;
}

export const TRIP_PACKAGES_NOT_READY_MESSAGE = "Tus paquetes todavía esperan la confirmación del pago.";

export function tripStartBlockerMessage(
  trip: Pick<TripWithAcceptedPackages, "departureAt">,
  blocker: TripStartBlocker,
): string {
  return blocker === "too_early"
    ? `Podés iniciarlo el ${formatTripStartDate(trip.departureAt)}.`
    : TRIP_PACKAGES_NOT_READY_MESSAGE;
}

/**
 * Reparte los viajes del transportista entre las dos secciones de Inicio, para que nunca
 * se contradigan: `primaryTrip` va a la card con CTA de "Estoy transportando" (el viaje en
 * curso, o si no hay, el primer `declared` con paquetes que sale hoy) y `otherTrips` (el
 * resto de los `declared` con paquetes) se listan en "Actividad reciente".
 *
 * La fecha solo decide cuál se lleva la card, nunca el estado: un `declared` con salida
 * pasada sigue siendo `declared` (cerrar esos viajes es del backend, no de la app).
 */
export function splitCarrierHomeTrips(trips: TripWithAcceptedPackages[]): {
  primaryTrip: TripWithAcceptedPackages | null;
  otherTrips: TripWithAcceptedPackages[];
} {
  const activeTrip = trips.find((t) => t.status === TripStatus.ACTIVE);
  const readyDeclared = trips
    .filter((t) => t.status === TripStatus.DECLARED && t.hasAcceptedPackages)
    .sort((a, b) => a.departureAt.localeCompare(b.departureAt));
  const primaryTrip =
    activeTrip ?? readyDeclared.find((t) => isTripDepartureToday(t.departureAt)) ?? null;
  return { primaryTrip, otherTrips: readyDeclared.filter((t) => t.id !== primaryTrip?.id) };
}

/** Localidad corta para un extremo del viaje: "San Martín 450, X5152 Villa Carlos Paz,
 * Córdoba, Argentina" → "Villa Carlos Paz". Si la dirección es solo la calle, cae a la
 * calle (`shortAddressLabel`). */
export function tripPlaceLabel(address: string): string {
  const locality = pickupLocalityLabel(address);
  return locality ? locality.split(",")[0].trim() : shortAddressLabel(address);
}

/** "Córdoba → Rosario" — identificador principal de un viaje en Inicio, en vez de la
 * fecha (que ya va en el subtítulo). */
export function tripRouteLabel(trip: { originAddress: string; destinationAddress: string }): string {
  return `${tripPlaceLabel(trip.originAddress)} → ${tripPlaceLabel(trip.destinationAddress)}`;
}

export function formatPackagesCount(count: number): string {
  return `${count} ${count === 1 ? "paquete" : "paquetes"}`;
}

/**
 * MOVO-252: Formatea el error devuelto al intentar iniciar un viaje (`POST /trips/:id/start`).
 * AC6: Si es 409 por límite de un viaje activo: "Ya tenés otro viaje en curso. Solo podés tener 1 viaje activo a la vez."
 * AC4: Si es genérico o de red: mensaje amigable sin alterar el estado del viaje.
 * MOVO-277: vuelven `TRIP_START_TOO_EARLY` (con la fecha) y `TRIP_PACKAGES_NOT_READY`.
 */
export function formatTripStartErrorMessage(err: unknown, departureAt?: string): string {
  if (err instanceof ApiError) {
    if (err.code === "TRIP_ALREADY_HAS_ACTIVE_TRIP") {
      return "Ya tenés otro viaje en curso. Solo podés tener 1 viaje activo a la vez.";
    }
    if (err.code === "TRIP_NOT_DECLARED") {
      return "El viaje ya fue iniciado o finalizado.";
    }
    // MOVO-277: la app ya oculta el botón en estos dos casos; llegan solo si el dato de
    // la pantalla quedó viejo (cambió el día, o un paquete volvió atrás).
    if (err.code === "TRIP_START_TOO_EARLY") {
      return departureAt
        ? `Podés iniciar este viaje el ${formatTripStartDate(departureAt)}.`
        : "Todavía no podés iniciar este viaje: se habilita el día de salida.";
    }
    if (err.code === "TRIP_PACKAGES_NOT_READY") {
      return `${TRIP_PACKAGES_NOT_READY_MESSAGE} Vas a poder iniciar el viaje cuando estén listos para retirar.`;
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
      // Se muestra como chip (`tripCarriedChipLabel`), no como línea de texto.
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

/**
 * Chip del historial para un viaje completado: "Llevaste 3 paquetes". No dice "entregados":
 * el conteo de paquetes aceptados incluye los que quedaron en disputa.
 */
export function tripCarriedChipLabel(count: number): string {
  return `Llevaste ${count} ${count === 1 ? "paquete" : "paquetes"}`;
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
