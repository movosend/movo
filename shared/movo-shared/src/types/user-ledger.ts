/**
 * MOVO-309 (DD-044): contrato de la cuenta corriente del usuario, que vive en
 * `movo-svc-payments`. Es del USUARIO, no de un rol: la misma persona puede deber como
 * transportista y enviar mañana como emisor. Montos en ARS con 2 decimales y CON SIGNO:
 * positivo = el usuario debe, negativo = pago o saldo a favor.
 */

/**
 * - `cancellation_penalty`: penalidad por cancelar (MOVO-226).
 * - `penalty_capture`: cobro de una penalidad con la captura parcial del hold (MOVO-307).
 * - `cash_commission`: comisión de Movo de un envío pagado en efectivo (MOVO-37).
 * - `fee_offset`: deuda descontada del `application_fee` de una operación (MOVO-311).
 * - `payment_surcharge`: deuda que el emisor paga como recargo en el pago de un envío (MOVO-311).
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
  /** Descripción pública del origen; nunca contiene el motivo interno de un ajuste. */
  originLabel?: string | null;
  /** Destino público del envío, sin el identificador que puede formar parte de `originLabel`. */
  destination?: string | null;
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
  items: Array<UserLedgerEntry & { originLabel: string | null; destination: string | null }>;
  nextCursor: string | null;
}

/**
 * MOVO-312: "Pagar mi saldo" con Checkout API (el usuario no sale de la app; mismo flujo que pagar un envío: tarjeta
 * guardada + CVV). El pago va a la cuenta cobradora de Movo, que se vincula por OAuth como la de un transportista.
 */

/** `GET /payments/balance/pay-data`: lo que la app necesita para tokenizar la tarjeta y mostrar el monto. */
export interface BalancePayDataResponse {
  /** `public_key` de la cuenta cobradora de Movo: con ella se genera el token (`card_id` + CVV) en el dispositivo. */
  publicKey: string;
  /** Saldo deudor actual: lo máximo que se puede pagar (mayor que cero; si no hay deuda responde 422). */
  balanceArs: number;
}

/** `POST /payments/balance/pay`. */
export interface BalancePayRequest {
  /** Lo que quiere pagar ahora: mayor que cero, con hasta 2 decimales y como mucho el saldo deudor. */
  amountArs: number;
  /** Token de un solo uso (`card_id` + CVV) generado en el dispositivo con la `publicKey` de `pay-data`. */
  cardToken: string;
  /** Id interno de la tarjeta guardada (`GET /payments/cards`) con la que se generó el token. */
  savedCardId: string;
  /** `visa`, `master`, etc., tal como lo devuelve el formulario de MP junto al token. */
  paymentMethodId?: string;
}

/**
 * Resultado del pago. Un rechazo de la tarjeta NO es un error HTTP: responde 200 con `status: "rejected"` y el motivo,
 * igual que el pago de un envío. `pending`: MP todavía no resolvió; el saldo se actualiza solo cuando llegue el webhook.
 */
export interface BalancePayResponse {
  attemptId: string;
  status: "approved" | "rejected" | "pending";
  failureReason: "insufficient_funds" | "card_rejected" | "invalid_data" | "platform_error" | null;
  /** Saldo después de este pago (con `pending`, el saldo todavía no cambió). */
  balanceArs: number;
}

/**
 * MOVO-311: vista previa de la deuda que se le descontaría a un transportista al cobrar estos precios
 * (`POST /internal/payments/users/:userId/debt-collection/preview`). No reserva nada.
 */
export interface DebtCollectionPreviewRequest {
  /** Precios brutos de las ofertas o envíos, hasta 100. */
  amountsArs: number[];
}

export interface DebtCollectionPreviewResponse {
  /** Deuda actual sin contar lo que ya reservaron holds en curso. 0 si no debe. */
  pendingBalanceArs: number;
  /** Lo que se descontaría en cada precio (mismo orden), con el tope por envío. */
  debtOffsetsArs: number[];
}

/**
 * MOVO-311: lo que se le descontaría al transportista de su cobro por la deuda de su cuenta corriente,
 * con el motivo, para que el "Recibís aprox." de ofertas y envíos lo reste antes de comprometerse.
 * `null` en la respuesta cuando no debe nada o no se pudo calcular.
 */
export interface CarrierDebtDiscount {
  amountArs: number;
  reason: "pending_balance";
}
