import type { DisputeOutcome, DisputePartyRole, DisputePaymentAction } from "../types/dispute";
import { DISPUTE_PARTIAL_PRESETS } from "../types/dispute";
import { estimateMpFeeArs } from "./commission";

/**
 * MOVO-337 (DD-056): reglas puras de la resolución de una disputa, compartidas entre `svc-admin` (valida y
 * muestra el mínimo) y `svc-shipments` (las aplica). Ningún servicio las reimplementa.
 */

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Estados del envío al abrirse la disputa desde los que se puede resolver: las columnas de la matriz. */
export const DISPUTE_RESOLVABLE_STATUSES_AT_OPEN = ["assigned", "in_transit", "delivered", "completed"] as const;
export type DisputeResolvableStatus = (typeof DISPUTE_RESOLVABLE_STATUSES_AT_OPEN)[number];

export function isDisputeResolvableStatus(status: string): status is DisputeResolvableStatus {
  return (DISPUTE_RESOLVABLE_STATUSES_AT_OPEN as readonly string[]).includes(status);
}

/**
 * La matriz de resolución (AC5 de MOVO-337):
 *
 * | Resultado   | `assigned` (hold ya liberado) | `in_transit` (hold sin capturar) | `delivered`/`completed` (capturado) |
 * | ----------- | ----------------------------- | -------------------------------- | ----------------------------------- |
 * | emisor      | nada                          | liberar el hold                  | reembolso total                     |
 * | transportista | crédito en la cuenta corriente | captura total                  | nada                                |
 * | parcial     | crédito en la cuenta corriente | captura parcial                 | reembolso parcial                   |
 */
export function disputePaymentAction(statusAtOpen: DisputeResolvableStatus, outcome: DisputeOutcome): DisputePaymentAction {
  switch (statusAtOpen) {
    case "assigned":
      return outcome === "sender" ? "none" : "ledger_credit";
    case "in_transit":
      return outcome === "sender" ? "release_hold" : outcome === "carrier" ? "capture_hold" : "capture_partial";
    case "delivered":
    case "completed":
      return outcome === "sender" ? "refund_full" : outcome === "carrier" ? "none" : "refund_partial";
  }
}

/** Estado final del envío (DD-056), sin estados nuevos: a favor del emisor -> `cancelled`; el resto -> `completed`. */
export function disputeFinalShipmentStatus(outcome: DisputeOutcome): "completed" | "cancelled" {
  return outcome === "sender" ? "cancelled" : "completed";
}

/** Quién puede calificar tras la resolución: el ganador; en `partial`, las dos partes (AC12). */
export function disputeRatingWinners(outcome: DisputeOutcome): DisputePartyRole[] {
  return outcome === "sender" ? ["sender"] : outcome === "carrier" ? ["carrier"] : ["sender", "carrier"];
}

export interface DisputeAmountChoice {
  /** Uno de `DISPUTE_PARTIAL_PRESETS`. */
  percentage?: number;
  /** Lo que conserva el transportista. */
  amountArs?: number;
}

export type DisputeAmountsError = "invalid_choice" | "above_maximum";

export interface DisputeAmounts {
  carrierAmountArs: number;
  senderAmountArs: number;
}

/**
 * Reparte el monto en juego entre el transportista y el emisor. `partial` exige exactamente uno de `percentage` (del
 * set predefinido) o `amountArs` (libre, mayor que cero y menor que el total); los otros resultados no aceptan ninguno.
 */
export function splitDisputeStake(
  stakeArs: number,
  outcome: DisputeOutcome,
  choice: DisputeAmountChoice,
): DisputeAmounts | { error: DisputeAmountsError } {
  if (outcome !== "partial") {
    if (choice.percentage !== undefined || choice.amountArs !== undefined) return { error: "invalid_choice" };
    return outcome === "carrier"
      ? { carrierAmountArs: round2(stakeArs), senderAmountArs: 0 }
      : { carrierAmountArs: 0, senderAmountArs: round2(stakeArs) };
  }
  if ((choice.percentage === undefined) === (choice.amountArs === undefined)) return { error: "invalid_choice" };
  let carrierAmountArs: number;
  if (choice.percentage !== undefined) {
    if (!DISPUTE_PARTIAL_PRESETS.includes(choice.percentage)) return { error: "invalid_choice" };
    carrierAmountArs = round2((stakeArs * choice.percentage) / 100);
  } else {
    if (!Number.isFinite(choice.amountArs) || (choice.amountArs as number) <= 0) return { error: "invalid_choice" };
    carrierAmountArs = round2(choice.amountArs as number);
  }
  if (carrierAmountArs >= round2(stakeArs) || carrierAmountArs <= 0) return { error: "above_maximum" };
  return { carrierAmountArs, senderAmountArs: round2(stakeArs - carrierAmountArs) };
}

/**
 * Piso de una captura parcial del hold: `svc-payments` la rechaza (`CAPTURE_BELOW_APPLICATION_FEE`) si lo capturado
 * menos el estimado de la comisión de MP no supera el `application_fee` del hold (spike MOVO-305). Devuelve el
 * menor monto que pasa esa misma cuenta.
 */
export function minimumPartialCaptureArs(applicationFeeArs: number): number {
  const passes = (amount: number): boolean => round2(amount - estimateMpFeeArs(amount)) > applicationFeeArs;
  let amount = Math.max(0.01, round2(applicationFeeArs));
  // Con una tasa de MP sana converge en pocos centavos; el tope evita un lazo infinito con una tasa absurda.
  for (let i = 0; i < 1_000_000 && !passes(amount); i += 1) amount = round2(amount + 0.01);
  return amount;
}
