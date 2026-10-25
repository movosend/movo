/**
 * MOVO-336: contrato interno del reembolso de un pago ya capturado entre quien resuelve una disputa
 * (`svc-shipments`/`svc-admin`, MOVO-337) y `movo-svc-payments`. Montos en ARS con 2 decimales.
 *
 * Una fila por INTENTO. Estados:
 * - `processing`: se reservó el monto y todavía no hay respuesta confirmada de MP (primer intento en curso,
 *   o la respuesta se perdió). Reintentable con la misma `idempotencyKey`: no devuelve la plata dos veces.
 * - `succeeded`: MP reembolsó al pagador.
 * - `failed`: MP rechazó el reembolso por una causa que reintentar no arregla sola (`failureReason`). No cuenta
 *   como reembolsado: un reintento con la misma key abre un intento nuevo.
 * - `fallback_to_ledger`: el transportista no tenía saldo en MP para devolver. No se reintentó contra MP: su deuda
 *   quedó en la cuenta corriente (`manual_adjustment`, DD-044) y el EMISOR NO RECIBIÓ la plata todavía: es un
 *   caso manual con alerta al equipo. Cuenta como reembolsado para el tope, así no se compensa dos veces.
 */
export const REFUND_STATUSES = ["processing", "succeeded", "failed", "fallback_to_ledger"] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Por qué un intento no terminó en `succeeded`. */
export type RefundFailureReason =
  | "insufficient_balance"
  | "carrier_account_unavailable"
  | "provider_error"
  | "unexpected_refund_status";

/** Largo del motivo del reembolso (queda en la fila y, en el fallback, en la cuenta corriente). */
export const REFUND_REASON_MIN_LENGTH = 3;
export const REFUND_REASON_MAX_LENGTH = 500;

/** Largo máximo de la `idempotencyKey` del llamador. */
export const REFUND_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/**
 * Body de `POST /internal/payments/settlements/by-shipment/:shipmentId/refund`.
 * - `amountArs` ausente = reembolso total de lo que todavía es reembolsable (capturado menos lo ya reembolsado).
 * - `idempotencyKey` es del llamador (p. ej. `dispute-<id>`): un reintento con la misma key devuelve el reembolso
 *   ya hecho o en curso; con la misma key y otro monto o motivo es `409 REFUND_IDEMPOTENCY_CONFLICT`.
 * - `adminId` es quien lo pidió: autor del ajuste en la cuenta corriente si hay que caer al fallback.
 */
export interface CreateRefundRequest {
  amountArs?: number;
  reason: string;
  idempotencyKey: string;
  adminId: string;
}

export interface RefundResponse {
  id: string;
  settlementId: string;
  shipmentId: string;
  /** Número de intento sobre la liquidación (1, 2...): es el `<n>` de la key de MP. */
  attempt: number;
  amountArs: number;
  reason: string;
  status: RefundStatus;
  failureReason: RefundFailureReason | null;
  /** Id del reembolso en MP; `null` si no se llegó a pedir o no se confirmó. */
  mpRefundId: string | null;
  /** Ajuste de la cuenta corriente del transportista que dejó el fallback; `null` en cualquier otro estado. */
  ledgerEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRefundResponse {
  refund: RefundResponse;
  /** `true` si no se le pegó a MP: el reembolso ya estaba hecho (o resuelto en el fallback). */
  replayed: boolean;
}

/** `GET /internal/payments/settlements/by-shipment/:shipmentId/refunds`: los intentos, del más viejo al más nuevo. */
export interface RefundsResponse {
  refunds: RefundResponse[];
  /** Lo que todavía se puede reembolsar: capturado menos `processing`, `succeeded` y `fallback_to_ledger`. */
  refundableArs: number;
}
