import { ApiError } from "@movo/shared/dist/errors/api-error";
import { TripStatus, type TripWithAcceptedPackages } from "../api/trips-client";
import { friendlyErrorMessage } from "./error-messages";
import { pickupLocalityLabel, shortAddressLabel } from "./shipment-format";

// MOVO-221: `declared` nuevo (estado inicial real, antes un viaje nacía directo en
// `active` sin ningún paso explícito de "arrancar el viaje" — ver POST /trips/:id/start).
const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  [TripStatus.DECLARED]: "Declarado",
  [TripStatus.ACTIVE]: "Activo",
  [TripStatus.CANCELLED]: "Cancelado",
  [TripStatus.EXPIRED]: "Vencido",
  [TripStatus.COMPLETED]: "Completado",
};

export function tripStatusLabel(status: TripStatus): string {
  return TRIP_STATUS_LABELS[status];
}

export function tripStatusTone(
  status: TripStatus,
): "success" | "warning" | "danger" | "lime" | "neutral" {
  switch (status) {
    case TripStatus.COMPLETED:
      return "success";
    case TripStatus.CANCELLED:
    case TripStatus.EXPIRED:
      return "danger";
    case TripStatus.DECLARED:
      return "neutral";
    case TripStatus.ACTIVE:
      // Acento de marca (lima) para el estado principal/en curso — feedback de UI
      // post-implementación: el tono "info" (azul) no es parte de la paleta de acento
      // de Movo, se pidió reemplazarlo por el lima característico.
      return "lime";
    case TripStatus.DECLARED:
    default:
      // MOVO-221: `declared` es el estado neutral por default (pendiente de iniciar,
      // "Iniciar viaje" todavía no se tocó) -- ya no comparte el lima de `active`,
      // que ahora significa específicamente "en curso".
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
