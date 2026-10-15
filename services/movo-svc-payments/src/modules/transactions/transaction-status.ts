import type { HoldStatus, SettlementStatus, TransactionStatus } from "@movo/shared";

export interface TransactionStatusInput {
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
 * Esta regla tiene un espejo en SQL (`STATUS_CASE_SQL` de `transaction-repository.ts`) para
 * filtrar por estado antes de paginar (AC9): cualquier cambio acá se replica allá, y la
 * integración verifica que ambos coincidan.
 */
export function deriveTransactionStatus(input: TransactionStatusInput): TransactionStatus {
  if (input.hasDispute) return "disputed";
  if (input.hasRefund) return "refunded";
  if (input.settlementStatus === "credited") return "completed";
  if (input.holdStatus === "cancelled") return "released";
  return "reserved";
}
