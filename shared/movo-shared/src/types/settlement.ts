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

/**
 * MOVO-306: qué originó la captura. Sigue habiendo UNA liquidación por envío: un envío se
 * entrega o se cancela, nunca las dos.
 * - `delivery`: captura del total al confirmarse la entrega (MOVO-212).
 * - `cancellation_penalty`: captura de PARTE del hold como penalidad de una cancelación tardía
 *   del emisor (MOVO-226/307); MP libera el resto.
 */
export const SETTLEMENT_KINDS = ["delivery", "cancellation_penalty"] as const;

export type SettlementKind = (typeof SETTLEMENT_KINDS)[number];

/**
 * Body de `POST /internal/payments/holds/by-shipment/:shipmentId/capture`. Sin body es una
 * captura de entrega por el total, como en MOVO-212.
 * - `delivery` no acepta `amountArs`: la entrega siempre cobra lo autorizado.
 * - `cancellation_penalty` exige `amountArs`, que tiene que ser MAYOR que el `application_fee`
 *   del hold (si no, `422 CAPTURE_BELOW_APPLICATION_FEE`: MP lo rechazaría con `4201`, spike
 *   MOVO-305) y no mayor que el monto del hold (`422 CAPTURE_AMOUNT_EXCEEDS_HOLD`).
 */
export interface CaptureHoldRequest {
  kind?: SettlementKind;
  amountArs?: number;
}

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
  kind: SettlementKind;
  /**
   * Lo que pagó el emisor: el monto del hold en una entrega (AC3 de MOVO-212), lo capturado en
   * una penalidad (MOVO-306).
   */
  grossAmountArs: number;
  /** Comisión de Mercado Pago (`fee_details`). `null` hasta que MP confirma la captura. */
  mpFeeArs: number | null;
  /**
   * Comisión de Movo (`application_fee`). En una captura parcial MP la cobra ENTERA, no
   * prorrateada (spike MOVO-305).
   */
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
  /**
   * MOVO-307: `delivery` es el cobro del envío entregado; `cancellation_penalty`, la
   * penalidad por una cancelación tardía (el transportista recibe la compensación).
   */
  kind: SettlementKind;
  status: SettlementDisplayStatus;
  /** Total que pagó el emisor. */
  paidAmountArs: number;
  /** Cuándo MP confirmó el cobro; `null` mientras no esté acreditada. */
  paidAt: string | null;
  /** Solo para el transportista, y `null` hasta que MP confirma la captura. */
  mpFeeArs?: number | null;
  commissionArs?: number;
  netAmountArs?: number | null;
}
