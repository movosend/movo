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
  /** Comisión de Movo: el `application_fee` menos la deuda cobrada (MOVO-311). */
  commissionArs: number;
  /** MOVO-311: deuda del transportista descontada de su cobro. */
  debtOffsetArs: number;
  /** MOVO-311: deuda del emisor cobrada como recargo (incluida en `grossAmountArs`). */
  debtSurchargeArs: number;
  /**
   * MOVO-311: parte del `application_fee` retenido que corresponde a ese recargo (el recargo menos la comisión
   * de MP sobre él, que absorbe Movo). Sirve para mostrarle al transportista su cobro sin el recargo
   * (`carrierPaymentView`).
   */
  debtSurchargeFeeArs: number;
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

/**
 * Estado de la liquidación tal como lo ve el usuario (AC10): `failed` se muestra como
 * `processing` porque desde afuera es "todavía se está cobrando"; el reintento y el
 * escalado manual son de MOVO-213.
 */
export type SettlementDisplayStatus = "processing" | "credited" | "escalated";

/**
 * `GET /shipments/:id/settlement` (`svc-shipments`), filtrado por rol (AC10 de MOVO-212):
 * - transportista: bruto, fee de MP, comisión de Movo y neto;
 * - emisor: solo el total pagado y la fecha (`mpFeeArs`/`commissionArs`/`netAmountArs`
 *   no viajan);
 * - receptor: no accede (403).
 */
export interface ShipmentSettlementResponse {
  shipmentId: string;
  role: "sender" | "carrier";
  status: SettlementDisplayStatus;
  /**
   * Emisor: total que pagó (con el recargo por su deuda, si lo hubo). Transportista: el bruto de su cobro, sin
   * ese recargo (MOVO-311, `carrierPaymentView`).
   */
  paidAmountArs: number;
  /**
   * MOVO-311: deuda de la cuenta corriente saldada en este envío, la de quien consulta: al transportista,
   * lo descontado de su cobro; al emisor, el recargo que pagó. 0 si no hubo.
   */
  debtCollectedArs: number;
  /** Cuándo MP confirmó el cobro; `null` mientras no esté acreditada. */
  paidAt: string | null;
  /** Solo para el transportista, y `null` hasta que MP confirma la captura. */
  mpFeeArs?: number | null;
  commissionArs?: number;
  netAmountArs?: number | null;
}
