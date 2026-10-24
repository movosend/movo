import type { HoldStatus, SettlementStatus, TransactionKind, TransactionStatus } from "@movo/shared";

export interface TransactionStatusInput {
  /** Por defecto `shipment`. Un pago de saldo solo se lista aprobado: siempre `completed`. */
  kind?: TransactionKind;
  holdStatus: HoldStatus;
  /** `null` si el hold no tiene liquidación. */
  settlementStatus: SettlementStatus | null;
  /** Contracargo o mediación registrados sobre el pago. */
  hasDispute: boolean;
  hasRefund: boolean;
}

/**
 * MOVO-303 AC6/7: estado que ve el usuario en el historial. Precedencia
 * `disputed` > `refunded` > `completed` > `released`/`reserved`. `completed` exige la
 * liquidación `credited`: un hold `captured` sin acreditar sigue `reserved`.
 *
 * Limitación aceptada (review de PR #256): si la liquidación queda `failed` o mucho tiempo en
 * `processing`, el cobro ya capturado se ve igual como `reserved`. El ticket fija cinco estados;
 * un estado de "cobro pendiente/con error" cambiaría el contrato y la UI. MOVO-213 (reintentos y `escalated`) tampoco lo
 * agrega: el transportista ve el cobro demorado por `GET /shipments/:id/settlement` (`displayStatus`) y por el push.
 *
 * Esta regla tiene un espejo en SQL (`STATUS_CASE` de `transaction-repository.ts`) para
 * filtrar por estado antes de paginar (AC9): cualquier cambio acá se replica allá, y la
 * integración verifica que ambos coincidan.
 */
export function deriveTransactionStatus(input: TransactionStatusInput): TransactionStatus {
  if (input.kind === "balance_payment") return "completed";
  if (input.hasDispute) return "disputed";
  if (input.hasRefund) return "refunded";
  if (input.settlementStatus === "credited") return "completed";
  if (input.holdStatus === "cancelled") return "released";
  return "reserved";
}
