import { CancellationCause } from "@movo/shared";

/** Estados de los que solo sale un barrido del receptor: no confirmó, o el emisor no eligió otro. */
const RECEIVER_STATUSES: ReadonlySet<string> = new Set(["awaiting_receiver_confirmation", "rejected_by_receiver"]);

/** El evento `-> cancelled` de un envío, con lo que hace falta para atribuirlo. */
export interface CancellationEventFacts {
  fromStatus: string | null;
  actorId: string | null;
  senderId: string;
  /** `ShipmentEventKind`: `normal`, o `manual`/`forced` si lo hizo un admin desde el panel. */
  kind: string;
  /** `PickupMissedAttribution`, solo en el barrido de retiro no realizado (MOVO-270). */
  attribution: string | null;
  /** La canceló `sanction-effects` al suspender la cuenta del emisor (`ShipmentEvent.sanctionWithdrawal`). */
  sanctionWithdrawal: boolean;
}

/**
 * MOVO-35 (DD-059): una causa por cancelación, en este orden. Sale de los campos estructurados del evento, nunca del
 * texto del motivo: el emisor lo escribe libre al cancelar.
 */
export function cancellationCauseOf(event: CancellationEventFacts): CancellationCause {
  if (event.fromStatus === "disputed") return "dispute";
  if (event.kind === "manual" || event.kind === "forced") return "admin";
  if (event.sanctionWithdrawal) return "sanction";
  if (event.attribution === "carrier") return "pickup_missed_carrier";
  if (event.attribution === "none") return "pickup_missed_other";
  if (event.actorId === null) return event.fromStatus !== null && RECEIVER_STATUSES.has(event.fromStatus) ? "receiver" : "expired";
  if (event.actorId === event.senderId) return "sender";
  return "other";
}
