import { ShipmentStatus } from "@movo/shared";
import { ShipmentEvent } from "../models/shipment";

/** AC8 de MOVO-146: ventana para calificar/editar, contada desde `deliveredAt`. */
export const RATING_WINDOW_HOURS = 72;

/**
 * AC9: una disputa activa (`disputed`) congela el reloj de las 72hs -- si no, una
 * disputa larga se come la ventana entera y nadie puede calificar cuando se resuelve.
 * Sin columna nueva: el instante de entrada a disputa ya está guardado en
 * `shipment_events` (MOVO-104/AC3 de MOVO-146), así que el tiempo total pasado en
 * disputa se reconstruye recorriendo el historial en vez de duplicar el dato en
 * `Shipment`. Hoy `disputed` no tiene transición de salida modelada
 * (`shipment-state-machine.ts`, MOVO-105 -- la resolución de una disputa es un ticket
 * futuro de admin), así que esto siempre resuelve a 0 en la práctica: queda listo para
 * cuando esa transición exista, sin tener que revisitar el cálculo de la ventana.
 */
function computeDisputeFrozenMs(events: readonly ShipmentEvent[]): number {
  let frozenMs = 0;
  let enteredDisputeAt: Date | null = null;

  for (const event of events) {
    if (event.toStatus === ShipmentStatus.DISPUTED) {
      enteredDisputeAt = event.createdAt;
    } else if (enteredDisputeAt !== null && event.fromStatus === ShipmentStatus.DISPUTED) {
      frozenMs += event.createdAt.getTime() - enteredDisputeAt.getTime();
      enteredDisputeAt = null;
    }
  }

  return frozenMs;
}

/** AC8/AC9: instante en que se cierra la ventana de calificación -- `deliveredAt` más
 * 72hs, extendido por cualquier tiempo ya pasado en disputa desde la entrega. */
export function computeRatingWindowDeadline(deliveredAt: Date, events: readonly ShipmentEvent[]): Date {
  const frozenMs = computeDisputeFrozenMs(events);
  return new Date(deliveredAt.getTime() + RATING_WINDOW_HOURS * 60 * 60 * 1000 + frozenMs);
}

export function isRatingWindowOpen(
  deliveredAt: Date,
  events: readonly ShipmentEvent[],
  now: Date = new Date(),
): boolean {
  return now.getTime() <= computeRatingWindowDeadline(deliveredAt, events).getTime();
}
