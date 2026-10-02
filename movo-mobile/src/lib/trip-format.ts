import { ApiError } from "@movo/shared/dist/errors/api-error";
import { TripStatus } from "../api/trips-client";
import { friendlyErrorMessage } from "./error-messages";

// MOVO-221: `declared` nuevo (estado inicial real, antes un viaje nacía directo en
// `active` sin ningún paso explícito de "arrancar el viaje" — ver POST /trips/:id/start).
const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  [TripStatus.DECLARED]: "Declarado",
  [TripStatus.ACTIVE]: "Activo",
  [TripStatus.CANCELLED]: "Cancelado",
  [TripStatus.COMPLETED]: "Completado",
  [TripStatus.EXPIRED]: "Expirado",
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
