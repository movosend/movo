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
export const HOLD_STATUSES = [
  "creating",
  "in_process",
  "authorized",
  "captured",
  "cancelled",
  "rejected",
] as const;

export type HoldStatus = (typeof HOLD_STATUSES)[number];

/**
 * Estados en los que el hold existe (o puede existir) del lado de MP. FUENTE ÚNICA de
 * la partición vivo/cerrado: `svc-payments` deriva de acá sus estados cerrados, y un test
 * de integración verifica que el predicado del índice único parcial de la base
 * (`holds_shipment_id_live_key`) liste exactamente estos valores.
 */
export const LIVE_HOLD_STATUSES: readonly HoldStatus[] = ["creating", "in_process", "authorized", "captured"];

/** Estados sin fondos retenidos: lo que no es vivo. */
export const CLOSED_HOLD_STATUSES: readonly HoldStatus[] = HOLD_STATUSES.filter(
  (status) => !LIVE_HOLD_STATUSES.includes(status),
);

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
  /** MOVO-311: usuario de Movo del emisor, para sumar su deuda al pago. Sin él no se le cobra deuda. */
  payerUserId?: string;
}

/**
 * MOVO-311: desglose de un pago que cobra deuda de la cuenta corriente. `amountArs` es lo que paga el
 * emisor y `applicationFeeArs` lo que retiene Movo; acá se ve de qué se componen.
 */
export interface HoldDebtBreakdown {
  /** Precio acordado del envío. */
  baseAmountArs: number;
  /** Deuda del transportista que se descuenta de lo que cobra (va en el `application_fee`). */
  debtOffsetArs: number;
  /**
   * Deuda del emisor que se suma al pago. Va en el `application_fee` menos el estimado de la comisión de
   * MP sobre ella (la absorbe Movo), así el transportista recibe lo mismo.
   */
  debtSurchargeArs: number;
}

export interface HoldCheckoutDataResponse extends HoldDebtBreakdown {
  shipmentId: string;
  /** `public_key` del transportista: con ella el mobile tokeniza la tarjeta. */
  publicKey: string;
  /** Lo que pagaría el emisor: precio + `debtSurchargeArs` (vista previa, MOVO-311). */
  amountArs: number;
  /** Lo que Movo retendrá al capturar (`application_fee`): comisión + deuda cobrada. */
  applicationFeeArs: number;
  payerEmail: string;
}

export interface CreateHoldRequest {
  shipmentId: string;
  carrierId: string;
  /** Token de un solo uso generado por el mobile con la `public_key` del transportista. */
  cardToken: string;
  /** Precio acordado. Lo que se cobra puede ser más si el emisor tiene deuda (MOVO-311, ver `HoldResponse`). */
  amountArs: number;
  payerEmail: string;
  /** Usuario de Movo del emisor (MOVO-282): dueño de la tarjeta guardada, si se usa una. */
  payerUserId: string;
  /**
   * MOVO-282 (ADR-039): id interno (`payments.saved_cards.id`) de la tarjeta guardada con la que se
   * generó el token (`card_id` + CVV). El pagador del hold pasa a ser el customer de esa tarjeta
   * (`payer: { type: "customer" }`) en vez del email. Sin él, el camino de siempre (tarjeta completa).
   * La tarjeta tiene que ser de `payerUserId` y estar viva; si no, 404 sin revelar si existe.
   */
  savedCardId?: string;
  /** `visa`, `master`, etc., tal como lo devuelve el formulario de MP junto al token. */
  paymentMethodId?: string;
  /**
   * MOVO-311: total que el emisor vio y confirmó (`totalArs` de `GET /shipments/:id/funding`). Si al crear el
   * intento lo que corresponde cobrar es otro monto (la deuda de su cuenta corriente cambió en el medio), se
   * responde 409 `HOLD_AMOUNT_CHANGED` en vez de cobrar de más. Sin él no se compara (builds viejos).
   */
  expectedTotalArs?: number;
}

export interface HoldResponse extends HoldDebtBreakdown {
  id: string;
  shipmentId: string;
  carrierId: string;
  /** Intento de reserva del envío (1, 2, ...): sube tras cada rechazo. */
  attempt: number;
  mpPaymentId: string | null;
  collectorId: string;
  /** `transaction_amount`: precio + `debtSurchargeArs`. */
  amountArs: number;
  /** `application_fee`: `commissionArs` + la deuda cobrada. */
  applicationFeeArs: number;
  /** MOVO-311: comisión de Movo sola, sin deuda. */
  commissionArs: number;
  status: HoldStatus;
  statusDetail: string | null;
  failureReason: HoldFailureReason | null;
  /** Hasta cuándo se espera que MP sostenga la reserva (config `MP_HOLD_VALIDITY_DAYS`). */
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}
