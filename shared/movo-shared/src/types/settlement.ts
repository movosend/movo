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
 *   NO vuelve atrás (la entrega ya ocurrió). Si el fallo es reintentable la liquidación espera su
 *   próximo intento (`nextAttemptAt`, MOVO-213).
 * - `escalated`: MOVO-213. Se agotaron los reintentos o el fallo no se arregla reintentando: la
 *   resuelve una persona (se avisa al equipo). El envío sigue `delivered`.
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

/** Por qué una liquidación quedó `failed` (o `escalated`). */
export type SettlementFailureReason =
  | "hold_expired"
  | "carrier_account_unavailable"
  | "provider_error"
  | "unexpected_payment_status";

/**
 * MOVO-213: por qué una liquidación pasó a `escalated`. `retries_exhausted`: se agotaron los reintentos
 * automáticos de un fallo reintentable. `not_retryable`: el fallo no se arregla reintentando (hold vencido o
 * cancelado, cuenta del transportista desvinculada) y escala sin gastar intentos.
 */
export type SettlementEscalationReason = "retries_exhausted" | "not_retryable";

/** MOVO-213: estados de la consulta de liquidaciones que necesitan atención. */
export const SETTLEMENT_ISSUE_STATUSES = ["failed", "escalated"] as const;
export type SettlementIssueStatus = (typeof SETTLEMENT_ISSUE_STATUSES)[number];

/**
 * MOVO-213 (AC6): una liquidación pendiente de reintento o escalada, para el proceso manual.
 * `GET /internal/payments/settlements?status=failed|escalated`.
 */
export interface SettlementIssueItem {
  id: string;
  shipmentId: string;
  carrierId: string;
  holdId: string;
  mpPaymentId: string;
  status: SettlementIssueStatus;
  failureReason: SettlementFailureReason | null;
  escalationReason: SettlementEscalationReason | null;
  /** Último error crudo (código/mensaje de MP o el motivo del chequeo previo). */
  lastError: string | null;
  attempts: number;
  /** Próximo reintento automático; `null` si está escalada. */
  nextAttemptAt: string | null;
  escalatedAt: string | null;
  /** Cuándo vence el hold según lo persistido (MOVO-209): ayuda a decidir si vale probar la captura a mano. */
  holdExpiresAt: string | null;
  grossAmountArs: number;
  createdAt: string;
  updatedAt: string;
}

export interface SettlementIssuesPage {
  items: SettlementIssueItem[];
  nextCursor: string | null;
}

/**
 * MOVO-213 (AC7): `POST /internal/shipments/:id/settlement-events`. `svc-payments` avisa a `svc-shipments`,
 * dueño del envío y de los pushes, qué pasó con la liquidación.
 * - `delayed`: el cobro quedó escalado; se le avisa al transportista que está en revisión (con plazo).
 * - `credited`: un reintento acreditó el cobro; el envío puede pasar a `completed`.
 */
export interface SettlementEventRequest {
  event: "delayed" | "credited";
}

export interface SettlementEventResponse {
  handled: boolean;
  outcome: string;
}

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
  /** MOVO-311: deuda del transportista descontada de su cobro. */
  debtOffsetArs: number;
  /** MOVO-311: deuda del emisor cobrada como recargo (incluida en `grossAmountArs`). */
  debtSurchargeArs: number;
  /**
   * MOVO-311: el bruto tal como lo ve el transportista, sin el recargo del emisor (`carrierPaymentView`, calculado
   * una vez al acreditar). Todo lo que se le muestra al transportista sale de acá, nunca de `grossAmountArs`.
   * Antes de acreditar es el bruto del hold.
   */
  carrierGrossAmountArs: number;
  /** MOVO-311: la comisión de MP sin la parte que cae sobre el recargo del emisor. `null` hasta la captura. */
  carrierMpFeeArs: number | null;
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
