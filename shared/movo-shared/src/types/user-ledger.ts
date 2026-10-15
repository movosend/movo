/**
 * MOVO-309 (ADR-044): contrato de la cuenta corriente del usuario, que vive en
 * `movo-svc-payments`. Es del USUARIO, no de un rol: la misma persona puede deber como
 * transportista y enviar mañana como emisor. Montos en ARS con 2 decimales y CON SIGNO:
 * positivo = el usuario debe, negativo = pago o saldo a favor.
 */

/**
 * - `cancellation_penalty`: penalidad por cancelar (MOVO-226).
 * - `penalty_capture`: cobro de una penalidad con la captura parcial del hold (MOVO-307).
 * - `cash_commission`: comisión de Movo de un envío pagado en efectivo (MOVO-37).
 * - `fee_offset`: deuda descontada del `application_fee` de una operación (MOVO-311).
 * - `payment_surcharge`: recargo asociado a un pago.
 * - `voluntary_payment`: el usuario salda su deuda con tarjeta (MOVO-312).
 * - `manual_adjustment`: ajuste de un administrador, siempre con motivo.
 */
export const USER_LEDGER_ENTRY_TYPES = [
  "cancellation_penalty",
  "penalty_capture",
  "cash_commission",
  "fee_offset",
  "payment_surcharge",
  "voluntary_payment",
  "manual_adjustment",
] as const;

export type UserLedgerEntryType = (typeof USER_LEDGER_ENTRY_TYPES)[number];

/**
 * - `pending`: registrado, todavía sin saldar.
 * - `reserved`: se está cobrando (hold o pago en curso); sigue contando para el saldo.
 * - `settled`: saldado.
 * - `voided`: anulado; deja de contar para el saldo.
 */
export const USER_LEDGER_ENTRY_STATUSES = ["pending", "reserved", "settled", "voided"] as const;

export type UserLedgerEntryStatus = (typeof USER_LEDGER_ENTRY_STATUSES)[number];

/** Rol con el que se generó el movimiento. Solo informativo: no condiciona cómo se salda. */
export const USER_LEDGER_ROLES = ["sender", "carrier"] as const;

export type UserLedgerRole = (typeof USER_LEDGER_ROLES)[number];

/** Saldo del usuario (endpoint interno). */
export interface UserLedgerBalanceResponse {
  /** Suma con signo de los movimientos no anulados. Positivo = debe; negativo = a favor. */
  balanceArs: number;
  /** Fecha del movimiento de deuda más viejo sin saldar. `null` si no hay deuda. */
  oldestUnpaidAt: string | null;
}

export interface UserLedgerEntry {
  id: string;
  userId: string;
  roleAtOrigin: UserLedgerRole | null;
  type: UserLedgerEntryType;
  /** Con signo; positivo = el usuario debe. */
  amountArs: number;
  status: UserLedgerEntryStatus;
  shipmentId: string | null;
  holdId: string | null;
  paymentId: string | null;
  /** Solo en `manual_adjustment`. Oculto (`null`) en `GET /payments/balance` para resguardar evidencia interna del admin. */
  reason: string | null;
  createdAt: string;
}

/** Alta de un movimiento (`POST /internal/payments/users/:userId/ledger-entries`). */
export interface CreateUserLedgerEntryRequest {
  /** Única: reenviar la misma key con el mismo cuerpo devuelve el movimiento ya creado. */
  idempotencyKey: string;
  type: Exclude<UserLedgerEntryType, "manual_adjustment">;
  roleAtOrigin?: UserLedgerRole;
  /** Con signo, distinto de cero. */
  amountArs: number;
  /** Por defecto `pending`. */
  status?: Exclude<UserLedgerEntryStatus, "voided">;
  shipmentId?: string;
  holdId?: string;
  paymentId?: string;
}

/** Ajuste manual de un administrador (`.../manual-adjustments`). */
export interface CreateManualAdjustmentRequest {
  idempotencyKey: string;
  /** Con signo, distinto de cero. */
  amountArs: number;
  /** Obligatorio: queda en el movimiento como evidencia. */
  reason: string;
  /** Quién lo hizo, para la auditoría. */
  adminId: string;
  shipmentId?: string;
}

/** Respuesta del alta: `created: false` cuando la idempotencyKey ya existía. */
export interface CreateUserLedgerEntryResponse {
  entry: UserLedgerEntry;
  created: boolean;
}

/** `GET /payments/balance`: saldo y movimientos del usuario autenticado, más nuevos primero. */
export interface UserLedgerPageResponse extends UserLedgerBalanceResponse {
  items: UserLedgerEntry[];
  nextCursor: string | null;
}
