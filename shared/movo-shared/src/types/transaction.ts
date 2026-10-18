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

/**
 * Qué es la transacción. `shipment` es el hold de un envío (lo que paga el emisor y cobra el
 * transportista). `balance_payment` es un pago de la cuenta corriente del usuario ("Pagar mi saldo",
 * MOVO-312): solo existe con `role=sender`, no tiene envío y solo se lista cuando MP lo aprobó (siempre
 * `completed`; un intento pendiente o rechazado no es una transacción todavía).
 */
export const TRANSACTION_KINDS = ["shipment", "balance_payment"] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_MOVEMENT_KINDS = ["refund", "chargeback", "mediation"] as const;

export type TransactionMovementKind = (typeof TRANSACTION_MOVEMENT_KINDS)[number];

export const TRANSACTIONS_DEFAULT_LIMIT = 20;
export const TRANSACTIONS_MAX_LIMIT = 50;

export interface TransactionCard {
  brand: string;
  /** `null` si Mercado Pago todavía no informó los últimos 4 (se completa con el próximo sync). */
  last4: string | null;
  /**
   * De la tarjeta guardada con la que se pagó (`savedCardId` del hold), para mostrar la misma tarjeta que el
   * usuario ve en Medios. Ausentes o `null` si el pago no usó una tarjeta guardada o ya no hay datos.
   */
  alias?: string | null;
  issuerName?: string | null;
  paymentType?: string | null;
}

/** Por qué se liberó un hold sin cobrar: `expired` si la reserva venció, `cancelled` en el resto. */
export const TRANSACTION_RELEASE_REASONS = ["cancelled", "expired"] as const;

export type TransactionReleaseReason = (typeof TRANSACTION_RELEASE_REASONS)[number];

export interface TransactionListItem {
  /** Id del hold, o del intento de pago si `kind` es `balance_payment`. */
  id: string;
  kind: TransactionKind;
  /** `null` en un `balance_payment`. */
  shipmentId: string | null;
  /**
   * Destino del envío ("Av. Colón 1234"), para titular la fila en vez del id. `null` en un `balance_payment` o si
   * svc-shipments no respondió: el cliente cae al código del envío.
   */
  destinationLabel?: string | null;
  /** Creación del hold (ISO 8601). */
  date: string;
  amountArs: number;
  status: TransactionStatus;
  /** Último monto devuelto que informó MP; `null` si no hay reembolso o MP no informó monto. */
  refundedAmountArs: number | null;
  /**
   * Parte de `amountArs` o del cobro que corresponde a la deuda de la cuenta corriente (MOVO-311), para
   * que el historial cierre con el Saldo. `role=sender`: el recargo por su deuda que viaja dentro de lo
   * que pagó. `role=carrier`: lo descontado de su cobro, solo con la liquidación acreditada (igual que
   * `breakdown`). `null` si no hubo deuda de por medio.
   */
  debtAmountArs: number | null;
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
  /** Cuándo se liberó la reserva sin cobrar (`status: released`); `null` si no se liberó. */
  releasedAt: string | null;
  releaseReason: TransactionReleaseReason | null;
  movements: TransactionMovement[];
  /**
   * Solo con `role=carrier` (con `role=sender` la clave no viaja, AC10 de MOVO-212): `null`
   * mientras la liquidación no esté `credited`.
   */
  breakdown?: TransactionBreakdown | null;
}
