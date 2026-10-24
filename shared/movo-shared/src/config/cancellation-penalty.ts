import { ShipmentStatus } from "../types/shipment";

/**
 * MOVO-307 (MOVO-226, ADR-047): penalidad por cancelar un envío `assigned`. Regla única,
 * compartida entre `movo-svc-shipments` (cotiza y cobra) y `movo-mobile` (muestra el monto
 * antes de confirmar), así los dos calculan lo mismo.
 *
 * Tramos, medidos contra el inicio de la ventana de retiro ACORDADA (la del envío después
 * de aceptar la oferta, MOVO-258 D3):
 * - faltan 12 h o más: sin cargo;
 * - faltan menos de 12 h y la ventana sigue abierta: 25 % del precio acordado;
 * - la ventana ya cerró: sin cargo (el que faltó fue el transportista), salvo que haya
 *   evidencia GPS de que el transportista llegó al retiro (MOVO-270, ADR-052): 25 %.
 */
export const CANCELLATION_PENALTY_FREE_HOURS = 12;

/** Fracción del precio acordado que se cobra como penalidad. */
export const CANCELLATION_PENALTY_RATE = 0.25;

/**
 * MOVO-340: estados desde los que el emisor puede cancelar. Es la única regla de
 * disponibilidad: el mobile muestra "Cancelar envío" con esto y `svc-shipments` lo
 * verifica contra su máquina de estados (`shipment-state-machine.test.ts`). No depende de
 * la fecha ni de la hora del retiro: un retiro el mismo día se cancela igual, y la hora
 * solo cambia la penalidad (`computeCancellationPenalty`).
 */
export const SENDER_CANCELLABLE_STATUSES: readonly ShipmentStatus[] = [
  ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
  // MOVO-253 AC4: en vez de elegir otro receptor, el emisor puede cancelar.
  ShipmentStatus.REJECTED_BY_RECEIVER,
  ShipmentStatus.PUBLISHED,
  ShipmentStatus.ASSIGNMENT_PENDING,
  // MOVO-308: todavía sin reserva, sin cargo.
  ShipmentStatus.ASSIGNED_UNFUNDED,
  // MOVO-308: con la penalidad de ADR-047.
  ShipmentStatus.ASSIGNED,
];

export function isSenderCancellableStatus(status: ShipmentStatus): boolean {
  return SENDER_CANCELLABLE_STATUSES.includes(status);
}

/**
 * - `not_assigned`: el envío no está `assigned` (todavía no hay fondos reservados): sin cargo.
 * - `before_free_deadline`: faltan 12 h o más para el retiro: sin cargo.
 * - `late_cancellation`: faltan menos de 12 h y la ventana sigue abierta: hay penalidad.
 * - `pickup_window_closed`: la ventana de retiro ya cerró: sin cargo.
 * - `carrier_arrived`: la ventana ya cerró pero el transportista llegó al retiro (MOVO-270): hay penalidad.
 */
export type CancellationPenaltyReason =
  | "not_assigned"
  | "before_free_deadline"
  | "late_cancellation"
  | "pickup_window_closed"
  | "carrier_arrived";

export interface CancellationPenaltyInput {
  status: ShipmentStatus;
  /** Precio acordado con el transportista. `null` si el envío no tiene asignación. */
  agreedPriceArs: number | null;
  /** Inicio de la ventana de retiro acordada (instante real). */
  pickupWindowStart: Date;
  /** Fin de la ventana de retiro acordada (instante real). */
  pickupWindowEnd: Date;
  /** MOVO-270: hay evidencia GPS de que el transportista llegó al retiro (`pickup_evidence`). */
  carrierArrivedAtPickup?: boolean;
  now?: Date;
}

export interface CancellationPenaltyQuote {
  /** Monto de la penalidad en ARS con 2 decimales; `0` si no corresponde. */
  penaltyArs: number;
  reason: CancellationPenaltyReason;
  /** Hasta cuándo (inclusive) se puede cancelar sin cargo (instante real). `null` si el envío no está `assigned`. */
  freeUntil: Date | null;
}

/**
 * `GET /shipments/:id/cancellation-quote` (`svc-shipments`): lo que el emisor pagaría si
 * cancela ahora. El mobile lo muestra y lo devuelve como `expectedPenaltyArs` al cancelar.
 */
export interface CancellationQuoteResponse {
  penaltyArs: number;
  reason: CancellationPenaltyReason;
  /** ISO. `null` si el envío no está `assigned`. */
  freeUntil: string | null;
}

/** Penalidad que correspondería si el emisor cancela en `now`. Función pura. */
export function computeCancellationPenalty(input: CancellationPenaltyInput): CancellationPenaltyQuote {
  const now = input.now ?? new Date();
  if (input.status !== ShipmentStatus.ASSIGNED || input.agreedPriceArs === null) {
    return { penaltyArs: 0, reason: "not_assigned", freeUntil: null };
  }

  const freeUntil = new Date(input.pickupWindowStart.getTime() - CANCELLATION_PENALTY_FREE_HOURS * 60 * 60 * 1000);
  // "12 h o más" es sin cargo: justo a las 12 h todavía no se cobra.
  if (now <= freeUntil) return { penaltyArs: 0, reason: "before_free_deadline", freeUntil };
  const penaltyArs = Math.round(input.agreedPriceArs * CANCELLATION_PENALTY_RATE * 100) / 100;
  if (now > input.pickupWindowEnd) {
    return input.carrierArrivedAtPickup
      ? { penaltyArs, reason: "carrier_arrived", freeUntil }
      : { penaltyArs: 0, reason: "pickup_window_closed", freeUntil };
  }
  return { penaltyArs, reason: "late_cancellation", freeUntil };
}

/**
 * MOVO-310: penalidad del transportista asignado que se baja del envío. Mismo umbral de 12 h que
 * el emisor, con dos diferencias:
 * - aplica desde cualquier estado con transportista (`assignment_pending`, `assigned_unfunded`,
 *   `assigned`): su penalidad es deuda en la cuenta corriente, no depende de que haya fondos;
 * - con la ventana ya cerrada TAMBIÉN se cobra: el que faltó es él (para el emisor es sin cargo
 *   por eso mismo). Se informa como `late_cancellation`, así `penaltyArs > 0` siempre va con ese motivo.
 * `not_assigned` solo sale si no hay precio acordado.
 */
export function computeCarrierWithdrawalPenalty(
  input: Omit<CancellationPenaltyInput, "status" | "carrierArrivedAtPickup">
): CancellationPenaltyQuote {
  // Sin fin de ventana, el tramo "ventana cerrada" no existe: todo lo posterior al plazo libre es tarde.
  return computeCancellationPenalty({ ...input, status: ShipmentStatus.ASSIGNED, pickupWindowEnd: new Date(8.64e15) });
}
