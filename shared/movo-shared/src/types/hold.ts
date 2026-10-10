/**
 * MOVO-209: contrato interno de holds entre `movo-svc-shipments` (dueño de la saga,
 * MOVO-210) y `movo-svc-payments`. Montos en ARS con 2 decimales.
 *
 * Estados del hold (el estado crudo de MP viaja aparte en `statusDetail`):
 * - `creating`: el intento se persistió pero MP todavía no respondió (o la respuesta se
 *   perdió). Un reintento reusa la misma idempotency key.
 * - `in_process`: MP lo dejó en revisión; cuenta como vigente.
 * - `authorized`: fondos reservados, pendientes de captura.
 * - `captured`: cobrado (MOVO-212).
 * - `cancelled`: liberado sin cobrar (por Movo o por MP).
 * - `rejected`: MP no autorizó; `failureReason` dice por qué.
 */
export type HoldStatus = "creating" | "in_process" | "authorized" | "captured" | "cancelled" | "rejected";

/** Estados en los que el hold existe (o puede existir) del lado de MP. */
export const LIVE_HOLD_STATUSES: readonly HoldStatus[] = ["creating", "in_process", "authorized", "captured"];

/**
 * Motivo diferenciado de un rechazo (AC5 de MOVO-209). Los tres primeros los resuelve
 * el emisor probando otra tarjeta o corrigiendo datos; `platform_error` no depende de él.
 */
export type HoldFailureReason = "insufficient_funds" | "card_rejected" | "invalid_data" | "platform_error";

export interface HoldCheckoutDataRequest {
  shipmentId: string;
  /** Usuario de Movo del transportista asignado. */
  carrierId: string;
  amountArs: number;
  /** Email del emisor: en sandbox tiene que ser el de una cuenta de prueba Comprador. */
  payerEmail: string;
}

export interface HoldCheckoutDataResponse {
  shipmentId: string;
  /** `public_key` del transportista: con ella el mobile tokeniza la tarjeta. */
  publicKey: string;
  amountArs: number;
  /** Comisión de Movo que se retendrá al capturar (`application_fee`). */
  applicationFeeArs: number;
  payerEmail: string;
}

export interface CreateHoldRequest {
  shipmentId: string;
  carrierId: string;
  /** Token de un solo uso generado por el mobile con la `public_key` del transportista. */
  cardToken: string;
  amountArs: number;
  payerEmail: string;
  /** `visa`, `master`, etc., tal como lo devuelve el formulario de MP junto al token. */
  paymentMethodId?: string;
}

export interface HoldResponse {
  id: string;
  shipmentId: string;
  carrierId: string;
  /** Intento de reserva del envío (1, 2, ...): sube tras cada rechazo. */
  attempt: number;
  mpPaymentId: string | null;
  collectorId: string;
  amountArs: number;
  applicationFeeArs: number;
  status: HoldStatus;
  statusDetail: string | null;
  failureReason: HoldFailureReason | null;
  /** Hasta cuándo se espera que MP sostenga la reserva (config `MP_HOLD_VALIDITY_DAYS`). */
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}
