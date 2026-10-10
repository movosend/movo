/**
 * MOVO-212: contrato interno de la liquidación (captura del hold + split) entre
 * `movo-svc-shipments` y `movo-svc-payments`. Montos en ARS con 2 decimales.
 *
 * Estados de la liquidación:
 * - `processing`: se pidió la captura y todavía no se confirmó el desglose con MP
 *   (primer intento en curso, o la respuesta de MP se perdió). Reintentable.
 * - `credited`: capturado y acreditado; `mpFeeArs`/`commissionArs`/`netAmountArs` son los
 *   `fee_details` reales que devolvió MP.
 * - `failed`: la captura no se pudo completar; `failureReason` dice por qué. El envío
 *   NO vuelve atrás (la entrega ya ocurrió); el reintento y el escalado son MOVO-213.
 * - `escalated`: reservado para MOVO-213 (proceso manual); 212 nunca lo escribe.
 */
export const SETTLEMENT_STATUSES = ["processing", "credited", "failed", "escalated"] as const;

export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/** Por qué una liquidación quedó `failed`. */
export type SettlementFailureReason =
  | "hold_expired"
  | "carrier_account_unavailable"
  | "provider_error"
  | "unexpected_payment_status";

export interface SettlementResponse {
  id: string;
  shipmentId: string;
  holdId: string;
  carrierId: string;
  mpPaymentId: string;
  status: SettlementStatus;
  /** Lo que pagó el emisor: el monto del hold, nunca otro (AC3). */
  grossAmountArs: number;
  /** Comisión de Mercado Pago (`fee_details`). `null` hasta que MP confirma la captura. */
  mpFeeArs: number | null;
  /** Comisión de Movo (`application_fee`). */
  commissionArs: number;
  /** Lo que recibe el transportista (`net_received_amount`). `null` hasta la captura. */
  netAmountArs: number | null;
  failureReason: SettlementFailureReason | null;
  /** Cuándo MP confirmó la captura. */
  capturedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaptureHoldResponse {
  settlement: SettlementResponse;
}
