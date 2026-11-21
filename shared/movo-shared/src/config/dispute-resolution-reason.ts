import type { DisputeOutcome } from "../types/dispute";

/**
 * MOVO-362: motivo del evento de resolución de una disputa (`disputed → completed|cancelled`). Lo escribe
 * `svc-shipments` y lo lee el mobile para saber a favor de quién se resolvió, porque los eventos no traen el `outcome`
 * (MOVO-363). Al estar en un solo lugar, cambiar la redacción no rompe la lectura en silencio. Archivo aparte de
 * `dispute-resolution.ts` para que el mobile lo importe sin arrastrar la config de comisiones.
 */
const DISPUTE_RESOLUTION_EVENT_REASONS: Record<DisputeOutcome, string> = {
  sender: "Disputa resuelta a favor del emisor",
  carrier: "Disputa resuelta a favor del transportista",
  partial: "Disputa resuelta con un resultado parcial",
};

export function disputeResolutionEventReason(outcome: DisputeOutcome): string {
  return DISPUTE_RESOLUTION_EVENT_REASONS[outcome];
}

/** Inversa de `disputeResolutionEventReason`; `null` si el motivo no es uno de esos (p. ej. un cambio forzado). */
export function disputeOutcomeFromEventReason(reason: string | null | undefined): DisputeOutcome | null {
  if (!reason) return null;
  const entry = (Object.entries(DISPUTE_RESOLUTION_EVENT_REASONS) as [DisputeOutcome, string][]).find(
    ([, text]) => text === reason,
  );
  return entry ? entry[0] : null;
}
