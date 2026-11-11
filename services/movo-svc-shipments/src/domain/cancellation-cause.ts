import { CancellationCause } from "@movo/shared";

/** Motivo que queda en la línea de tiempo de lo que se retira por una sanción (MOVO-297 AC3). */
export const SANCTION_WITHDRAWAL_REASON = "cuenta suspendida";

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
  reason: string | null;
}

/**
 * MOVO-35 (DD-059): una causa por cancelación, en este orden. Sale de los campos del evento y no del texto, salvo la
 * sanción, que no tiene otra marca: su motivo es una constante y el actor es el propio emisor sancionado.
 */
export function cancellationCauseOf(event: CancellationEventFacts): CancellationCause {
  if (event.fromStatus === "disputed") return "dispute";
  if (event.kind === "manual" || event.kind === "forced") return "admin";
  if (event.reason === SANCTION_WITHDRAWAL_REASON) return "sanction";
  if (event.attribution === "carrier") return "pickup_missed_carrier";
  if (event.attribution === "none") return "pickup_missed_other";
  if (event.actorId === null) return event.fromStatus !== null && RECEIVER_STATUSES.has(event.fromStatus) ? "receiver" : "expired";
  if (event.actorId === event.senderId) return "sender";
  return "other";
}
