import type { CancellationQuoteResponse } from "@movo/shared/dist/config/cancellation-penalty";
import type { ShipmentSettlementResponse } from "@movo/shared/dist/types/settlement";
import type { TransactionListItem } from "@movo/shared/dist/types/transaction";
import type { ShipmentSummary } from "../api/shipments-client";
import { estimateReceivedArs } from "./commission-config";
import { formatSettlementAmount, formatSettlementDateTime } from "./settlement-format";

/**
 * Qué muestra el sheet de cancelación del emisor (MOVO-308, ADR-047), según la cotización de
 * `GET /shipments/:id/cancellation-quote`. Referencia visual: "MOVO-308 Emisor cancela" de
 * Claude Design.
 *
 * - `free`: falta más de 12 h para la franja de retiro, se libera la reserva entera.
 * - `penalty`: cancelación tardía, se cobra `penaltyArs` de la reserva y se libera el resto.
 * - `expired`: la franja de retiro ya terminó sin que el transportista retire: sin cargo.
 *   Si el transportista llegó al retiro (MOVO-270, `carrier_arrived`) se cobra: vista `penalty`.
 * - `noHold`: el envío todavía no tiene reserva (cualquier estado previo a `assigned`).
 */
export type CancellationQuoteView =
  | { kind: "free"; reservedArs: number | null; freeUntilLabel: string | null }
  | {
      kind: "penalty";
      reservedArs: number;
      penaltyArs: number;
      releasedArs: number;
      penaltyRatio: number;
      /** MOVO-270: por qué se cobra con la franja ya terminada (`carrier_arrived`); ausente en una cancelación tardía. */
      reasonText?: string;
    }
  | { kind: "expired"; reservedArs: number | null; reasonText: string }
  | { kind: "noHold" };

/** El backend solo manda el enum (`pickup_window_closed`); el texto es nuestro. */
export const PICKUP_WINDOW_CLOSED_REASON =
  "La franja de retiro ya terminó y el transportista no retiró el paquete, así que no corresponde cobrarte.";

/** MOVO-270 (`carrier_arrived`): la franja terminó, pero registramos que el transportista llegó al retiro. */
export const CARRIER_ARRIVED_REASON =
  "El transportista llegó al punto de retiro dentro de la franja, así que cancelar tiene un cargo.";

/** "jue 16 oct a las 08:00", en la zona del dispositivo (mismo criterio que el resto de los
 * horarios de la app). `null` ante una fecha inválida. */
export function formatCancellationDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const label = formatSettlementDateTime(iso);
  return label ? label.replace(", ", " a las ") : null;
}

export function cancellationQuoteView(
  quote: CancellationQuoteResponse,
  agreedPriceArs: number | null,
): CancellationQuoteView {
  switch (quote.reason) {
    case "before_free_deadline":
      return { kind: "free", reservedArs: agreedPriceArs, freeUntilLabel: formatCancellationDateTime(quote.freeUntil) };
    case "pickup_window_closed":
      return { kind: "expired", reservedArs: agreedPriceArs, reasonText: PICKUP_WINDOW_CLOSED_REASON };
    case "late_cancellation":
    case "carrier_arrived": {
      // El backend calcula la penalidad sobre el precio pactado, así que siempre existe acá.
      const reservedArs = agreedPriceArs ?? quote.penaltyArs;
      return {
        kind: "penalty",
        reservedArs,
        penaltyArs: quote.penaltyArs,
        releasedArs: Math.round((reservedArs - quote.penaltyArs) * 100) / 100,
        penaltyRatio: reservedArs > 0 ? Math.min(1, quote.penaltyArs / reservedArs) : 0,
        ...(quote.reason === "carrier_arrived" ? { reasonText: CARRIER_ARRIVED_REASON } : {}),
      };
    }
    case "not_assigned":
    default:
      return { kind: "noHold" };
  }
}

/**
 * Qué muestra el sheet de baja del transportista (MOVO-314, ADR-047), según
 * `GET /shipments/:id/carrier-withdrawal-quote`. A diferencia del emisor no hay "ventana vencida
 * sin cargo": con la franja cerrada el transportista igual paga. Toda penalidad es deuda en su
 * cuenta corriente, no un cobro de tarjeta.
 */
export type CarrierWithdrawalQuoteView = { kind: "free" } | { kind: "debt"; penaltyArs: number };

export function carrierWithdrawalQuoteView(quote: Pick<CancellationQuoteResponse, "penaltyArs">): CarrierWithdrawalQuoteView {
  return quote.penaltyArs > 0 ? { kind: "debt", penaltyArs: quote.penaltyArs } : { kind: "free" };
}

/** Texto del aviso de deuda (AC2 de MOVO-314); el mismo para el envío suelto y para el viaje. */
export function carrierDebtNotice(penaltyArs: number): string {
  return `Se te va a registrar una deuda de ${formatSettlementAmount(penaltyArs)} que se descuenta de tus próximos cobros.`;
}

/** Aviso del sheet cuando la confirmación vuelve con 409 `CANCELLATION_PENALTY_MISMATCH`: la
 * penalidad cambió entre que el emisor la vio y que confirmó. */
export function penaltyMismatchNotice(previousArs: number, nextArs: number): { title: string; body: string } {
  const title = "El monto cambió. Revisalo antes de confirmar.";
  if (nextArs <= 0) {
    return { title, body: `Ya no corresponde cobrarte la penalidad de ${formatSettlementAmount(previousArs)}.` };
  }
  if (previousArs <= 0) {
    return { title, body: `Ahora la cancelación tiene una penalidad de ${formatSettlementAmount(nextArs)} porque se acercó la hora del retiro.` };
  }
  return {
    title,
    body: `La penalidad pasó de ${formatSettlementAmount(previousArs)} a ${formatSettlementAmount(nextArs)} porque se acercó la hora del retiro.`,
  };
}

export interface PaymentCardLine {
  label: string;
  value: string;
  tone?: "danger";
}

/**
 * Card "Tu pago" de un envío cancelado visto por el emisor (MOVO-308). `null` si nunca hubo
 * reserva (no hay nada que contar sobre su tarjeta). Según `cancellationPenaltyStatus`:
 *
 * - sin penalidad: "Sin cargo", se liberó todo lo reservado.
 * - `captured`: la penalidad se cobró de la reserva, el resto se liberó.
 * - `pending`: el cobro de la penalidad está en curso.
 * - `debt`: el cobro falló, la reserva se liberó entera y la penalidad quedó como saldo en la
 *   cuenta corriente (se suma al próximo pago, MOVO-311).
 */
export interface SenderCancelledPaymentView {
  processing: boolean;
  reservedArs: number;
  lines: PaymentCardLine[];
  releasedLabel: string;
  releasedArs: number;
  note: string | null;
}

export function senderCancelledPaymentView(
  shipment: Pick<ShipmentSummary, "cancellationPenaltyArs" | "cancellationPenaltyStatus">,
  hold: Pick<TransactionListItem, "amountArs"> | null,
): SenderCancelledPaymentView | null {
  if (!hold) return null;
  const reservedArs = hold.amountArs;
  const penaltyArs = shipment.cancellationPenaltyArs ?? 0;
  const status = shipment.cancellationPenaltyStatus ?? null;

  // Penalidad sin estado todavía: el backend no terminó de registrarla, no es "Sin cargo".
  if (penaltyArs > 0 && status === null) {
    return {
      processing: true,
      reservedArs,
      lines: [{ label: "Penalidad", value: "Calculando…" }],
      releasedLabel: "Se libera en tu tarjeta",
      releasedArs: reservedArs,
      note: null,
    };
  }
  if (penaltyArs <= 0 || status === null) {
    return {
      processing: false,
      reservedArs,
      lines: [{ label: "Penalidad cobrada", value: "Sin cargo" }],
      releasedLabel: "Liberado en tu tarjeta",
      releasedArs: reservedArs,
      note: null,
    };
  }

  const releasedAfterPenalty = Math.max(0, Math.round((reservedArs - penaltyArs) * 100) / 100);
  if (status === "debt") {
    return {
      processing: false,
      reservedArs,
      lines: [{ label: "Penalidad pendiente", value: formatSettlementAmount(penaltyArs), tone: "danger" }],
      releasedLabel: "Liberado en tu tarjeta",
      releasedArs: reservedArs,
      note: "No pudimos cobrar la penalidad de tu tarjeta, así que te liberamos la reserva entera. La penalidad quedó como saldo pendiente y se suma a tu próximo pago.",
    };
  }
  if (status === "pending") {
    return {
      processing: true,
      reservedArs,
      lines: [{ label: "Penalidad", value: `− ${formatSettlementAmount(penaltyArs)}`, tone: "danger" }],
      releasedLabel: "Se libera en tu tarjeta",
      releasedArs: releasedAfterPenalty,
      note: null,
    };
  }
  return {
    processing: false,
    reservedArs,
    lines: [{ label: "Penalidad cobrada", value: `− ${formatSettlementAmount(penaltyArs)}`, tone: "danger" }],
    releasedLabel: "Liberado en tu tarjeta",
    releasedArs: releasedAfterPenalty,
    note: null,
  };
}

/**
 * Card "Compensación por cancelación" del transportista (MOVO-308 AC4): lo que le queda de la
 * penalidad que pagó el emisor, neta de la comisión de Movo y del fee de MP (≈ 11 % del
 * precio, spike MOVO-305). Mientras no se acredita, el neto es un estimado ("Recibís aprox.",
 * regla de MOVO-225); acreditado, el monto real.
 */
export type CarrierCompensationView =
  | {
      kind: "credited";
      penaltyArs: number;
      commissionArs: number;
      mpFeeArs: number;
      netArs: number;
      creditedAtLabel: string | null;
    }
  | { kind: "processing" | "escalated"; penaltyArs: number; commissionArs: number | null; estimatedNetArs: number | null };

export function carrierCompensationView(settlement: ShipmentSettlementResponse | null | undefined): CarrierCompensationView | null {
  if (!settlement || settlement.kind !== "cancellation_penalty") return null;
  const penaltyArs = settlement.paidAmountArs;
  if (
    settlement.status === "credited" &&
    settlement.netAmountArs != null &&
    settlement.mpFeeArs != null &&
    settlement.commissionArs != null
  ) {
    return {
      kind: "credited",
      penaltyArs,
      commissionArs: settlement.commissionArs,
      mpFeeArs: settlement.mpFeeArs,
      netArs: settlement.netAmountArs,
      creditedAtLabel: settlement.paidAt ? formatSettlementDateTime(settlement.paidAt) : null,
    };
  }
  const commissionArs = settlement.commissionArs ?? null;
  return {
    kind: settlement.status === "escalated" ? "escalated" : "processing",
    penaltyArs,
    commissionArs,
    estimatedNetArs:
      commissionArs === null ? null : Math.max(0, estimateReceivedArs(penaltyArs - commissionArs, penaltyArs)),
  };
}
