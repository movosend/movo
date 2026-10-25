// Schemas de /internal/payments/settlements/by-shipment/:shipmentId/refund[s] (MOVO-336). Reflejan
// `types/refund.ts` de @movo/shared. Endpoints internos: `hide: true`.
import { REFUND_IDEMPOTENCY_KEY_MAX_LENGTH, REFUND_REASON_MAX_LENGTH, REFUND_REASON_MIN_LENGTH, REFUND_STATUSES } from "@movo/shared";

// A diferencia del de las liquidaciones declara `details`: sin eso Fastify lo recorta y el llamador no ve
// `refundableArs` del 422 (mismo gotcha que `svc-admin`, MOVO-332).
const errorResponse = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        statusCode: { type: "number" },
        details: { type: "object", additionalProperties: true },
      },
    },
    requestId: { type: "string" },
  },
} as const;

const uuid = { type: "string", format: "uuid" } as const;

const shipmentIdParams = {
  type: "object",
  required: ["shipmentId"],
  properties: { shipmentId: uuid },
} as const;

const refund = {
  type: "object",
  required: [
    "id",
    "settlementId",
    "shipmentId",
    "attempt",
    "amountArs",
    "reason",
    "status",
    "failureReason",
    "mpRefundId",
    "ledgerEntryId",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: uuid,
    settlementId: uuid,
    shipmentId: uuid,
    attempt: { type: "integer" },
    amountArs: { type: "number" },
    reason: { type: "string" },
    status: { type: "string", enum: [...REFUND_STATUSES] },
    failureReason: {
      type: ["string", "null"],
      enum: ["insufficient_balance", "carrier_account_unavailable", "provider_error", "unexpected_refund_status", null],
    },
    mpRefundId: { type: ["string", "null"] },
    ledgerEntryId: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export const createRefundSchema = {
  hide: true,
  tags: ["settlements"],
  summary: "Reembolsa total o parcialmente un pago ya capturado (idempotente por `idempotencyKey`)",
  description:
    "200 con el intento: `succeeded` (MP devolvió la plata), `processing` (MP lo aceptó pero no lo acreditó todavía) o " +
    "`fallback_to_ledger` (el transportista no tiene saldo en MP: su deuda quedó en la cuenta corriente y el emisor " +
    "queda como caso manual con alerta). Sin `amountArs` es el total de lo reembolsable. Un reintento con la misma " +
    "`idempotencyKey` devuelve el intento vivo (`replayed: true` si no se le pegó a MP). 404 `SETTLEMENT_NOT_FOUND`; " +
    "409 `SETTLEMENT_NOT_REFUNDABLE` si la liquidación no está capturada, `REFUND_IDEMPOTENCY_CONFLICT` si la key " +
    "se usó con otro monto o motivo, `CARRIER_MP_ACCOUNT_NOT_LINKED` si no hay credenciales usables; 422 " +
    "`REFUND_AMOUNT_EXCEEDS_REFUNDABLE` (con `details.refundableArs`); 502 `PAYMENT_PROVIDER_ERROR` si MP rechazó " +
    "o no respondió (el intento queda `failed` o `processing`, consultable).",
  params: shipmentIdParams,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["reason", "idempotencyKey", "adminId"],
    properties: {
      amountArs: { type: "number", exclusiveMinimum: 0 },
      reason: { type: "string", minLength: REFUND_REASON_MIN_LENGTH, maxLength: REFUND_REASON_MAX_LENGTH },
      idempotencyKey: { type: "string", minLength: 1, maxLength: REFUND_IDEMPOTENCY_KEY_MAX_LENGTH },
      adminId: uuid,
    },
  },
  response: {
    200: {
      type: "object",
      required: ["refund", "replayed"],
      properties: { refund, replayed: { type: "boolean" } },
    },
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
    502: errorResponse,
  },
} as const;

export const listRefundsSchema = {
  hide: true,
  tags: ["settlements"],
  summary: "Intentos de reembolso de un envío y lo que todavía se puede reembolsar",
  params: shipmentIdParams,
  response: {
    200: {
      type: "object",
      required: ["refunds", "refundableArs"],
      properties: { refunds: { type: "array", items: refund }, refundableArs: { type: "number" } },
    },
    404: errorResponse,
  },
} as const;
