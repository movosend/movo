import type { DisputeOutcome } from "../types/dispute";

/**
 * Motivo del evento de resolución de una disputa (`disputed → completed|cancelled`), que escribe `svc-shipments`. Es
 * solo texto para mostrar (p. ej. en el panel): el resultado de la disputa se lee de `resolvedDisputes` del detalle del
 * envío (MOVO-363), no de este texto. Archivo aparte de `dispute-resolution.ts` para no arrastrar la config de comisiones.
 */
const DISPUTE_RESOLUTION_EVENT_REASONS: Record<DisputeOutcome, string> = {
  sender: "Disputa resuelta a favor del emisor",
  carrier: "Disputa resuelta a favor del transportista",
  partial: "Disputa resuelta con un resultado parcial",
};

export function disputeResolutionEventReason(outcome: DisputeOutcome): string {
  return DISPUTE_RESOLUTION_EVENT_REASONS[outcome];
}
