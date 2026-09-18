import { TripStatus } from "../api/trips-client";

// MOVO-221: `declared` nuevo (estado inicial real, antes un viaje nacía directo en
// `active` sin ningún paso explícito de "arrancar el viaje" — ver POST /trips/:id/start).
const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  [TripStatus.DECLARED]: "Declarado",
  [TripStatus.ACTIVE]: "Activo",
  [TripStatus.CANCELLED]: "Cancelado",
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
      return "danger";
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
