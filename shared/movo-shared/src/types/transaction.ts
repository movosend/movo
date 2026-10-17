/**
 * MOVO-303 (historial de MOVO-28): contrato de `GET /payments/transactions`. Una transacción es
 * un hold de `svc-payments`; los reembolsos y contracargos viajan anidados (`movements`), no
 * como filas aparte. Montos en ARS con 2 decimales.
 *
 * Estados derivados (precedencia `disputed` > `refunded` > `completed` > `reserved`):
 * - `reserved`: fondos retenidos (hold `authorized`/`in_process`), o capturado sin liquidación
 *   acreditada todavía.
 * - `completed`: capturado y liquidación `credited`.
 * - `refunded`: Mercado Pago informó un reembolso.
 * - `disputed`: contracargo o mediación abierta.
 * - `released`: hold liberado sin cobrar (cancelado con pago en MP).
 */
export const TRANSACTION_STATUSES = ["reserved", "completed", "refunded", "disputed", "released"] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/** Desde qué lado se mira la transacción: lo que pagó el emisor o lo que cobró el transportista. */
export const TRANSACTION_ROLES = ["sender", "carrier"] as const;

export type TransactionRole = (typeof TRANSACTION_ROLES)[number];

export const TRANSACTION_MOVEMENT_KINDS = ["refund", "chargeback", "mediation"] as const;

export type TransactionMovementKind = (typeof TRANSACTION_MOVEMENT_KINDS)[number];

export const TRANSACTIONS_DEFAULT_LIMIT = 20;
export const TRANSACTIONS_MAX_LIMIT = 50;

export interface TransactionCard {
  brand: string;
  /** `null` si Mercado Pago todavía no informó los últimos 4 (se completa con el próximo sync). */
  last4: string | null;
}

export interface TransactionListItem {
  /** Id del hold. */
  id: string;
  shipmentId: string;
  /** Creación del hold (ISO 8601). */
  date: string;
  amountArs: number;
  status: TransactionStatus;
  /** Último monto devuelto que informó MP; `null` si no hay reembolso o MP no informó monto. */
  refundedAmountArs: number | null;
  /** Solo con `role=sender`; `null` si el hold no tiene datos de tarjeta. */
  card?: TransactionCard | null;
}

export interface TransactionListResponse {
  items: TransactionListItem[];
  /** Cursor opaco para la página siguiente; `null` en la última. */
  nextCursor: string | null;
}

export interface TransactionMovement {
  kind: TransactionMovementKind;
  amountArs: number | null;
  date: string;
}

export interface TransactionBreakdown {
  grossArs: number;
  mpFeeArs: number;
  commissionArs: number;
  /** MOVO-311: deuda de la cuenta corriente del transportista descontada de este cobro. */
  debtOffsetArs: number;
  netArs: number;
}

export interface TransactionDetail extends TransactionListItem {
  /** Cuándo se capturó el pago; `null` si todavía no. */
  capturedAt: string | null;
  movements: TransactionMovement[];
  /**
   * Solo con `role=carrier` (con `role=sender` la clave no viaja, AC10 de MOVO-212): `null`
   * mientras la liquidación no esté `credited`.
   */
  breakdown?: TransactionBreakdown | null;
}
