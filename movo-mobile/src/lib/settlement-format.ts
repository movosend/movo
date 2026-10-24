import type { ShipmentSettlementResponse } from "@movo/shared/dist/types/settlement";
import { formatTimeOfDay } from "./time-format";

/**
 * Qué muestra el detalle del pago de un envío entregado (MOVO-214), según quién mira y en qué
 * quedó la liquidación (MOVO-212). Regla de fondo (AC4): un monto acreditado solo aparece si
 * la liquidación está `credited` y trae el neto; cualquier otra cosa es "en proceso".
 *
 * - `carrier_credited`: bruto, comisión de Movo, fee de MP y neto, con la fecha (AC1).
 * - `carrier_processing`/`sender_processing`: se está cobrando (incluye el 404 de una
 *   liquidación que todavía no existe). `amountArs` es lo que pagó o reservó el emisor.
 * - `carrier_escalated`: el cobro quedó en revisión manual (MOVO-213 AC5).
 * - `sender_paid`: total y fecha de la captura, sin desglose (AC2). Una liquidación escalada
 *   el emisor la ve como "en proceso": la demora es entre Movo y el transportista.
 */
export type PaymentView =
  | {
      kind: "carrier_credited";
      grossArs: number;
      commissionArs: number;
      mpFeeArs: number;
      netArs: number;
      creditedAt: string | null;
    }
  | { kind: "carrier_processing"; amountArs: number | null }
  | { kind: "carrier_escalated"; amountArs: number | null }
  | { kind: "sender_paid"; amountArs: number; paidAt: string | null }
  | { kind: "sender_processing"; amountArs: number | null };

export type PaymentViewerRole = "sender" | "carrier";

/**
 * `settlement` es `null` cuando el backend todavía no tiene liquidación (404). `fallbackAmountArs`
 * (el precio pactado del envío) cubre ese caso, para mostrar al menos el monto en juego.
 */
export function resolvePaymentView(
  role: PaymentViewerRole,
  settlement: ShipmentSettlementResponse | null,
  fallbackAmountArs: number | null,
): PaymentView {
  const amountArs = settlement?.paidAmountArs ?? fallbackAmountArs;

  if (role === "sender") {
    if (settlement?.status === "credited") {
      return {
        kind: "sender_paid",
        amountArs: settlement.paidAmountArs,
        paidAt: settlement.paidAt,
      };
    }
    return { kind: "sender_processing", amountArs };
  }

  if (settlement?.status === "escalated")
    return { kind: "carrier_escalated", amountArs };
  if (
    settlement?.status === "credited" &&
    settlement.netAmountArs != null &&
    settlement.mpFeeArs != null &&
    settlement.commissionArs != null
  ) {
    return {
      kind: "carrier_credited",
      grossArs: settlement.paidAmountArs,
      commissionArs: settlement.commissionArs,
      mpFeeArs: settlement.mpFeeArs,
      netArs: settlement.netAmountArs,
      creditedAt: settlement.paidAt,
    };
  }
  return { kind: "carrier_processing", amountArs };
}

export function escalatedSettlementMessage(): string {
  return (
    "No pudimos acreditarte el pago de este envío y lo estamos revisando a mano. " +
    "Te escribimos a la brevedad con una solución."
  );
}

/** Montos con centavos solo cuando los hay ("$11.311,38", "$13.800"): el neto y el fee de MP
 * vienen de `fee_details` y casi nunca son enteros. */
export function formatSettlementAmount(value: number): string {
  const decimals = Number.isInteger(value) ? 0 : 2;
  return `$${value.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "mar 14 oct, 16:42 h", en la zona del dispositivo. `null` ante una fecha inválida. Se arma
 * por partes porque el formato completo de `Intl` cambia comas y puntos según el motor. */
export function formatSettlementDateTime(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    DATE_TIME_FORMATTER.formatToParts(date).map((part) => [
      part.type,
      part.value.replace(".", ""),
    ]),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>;
  return `${parts.weekday} ${parts.day} ${parts.month}, ${formatTimeOfDay(date)}`;
}
