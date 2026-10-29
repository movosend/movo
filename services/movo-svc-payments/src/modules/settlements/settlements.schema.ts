// Schemas de /internal/payments (captura y liquidación, MOVO-212/306). Reflejan
// `types/settlement.ts` de @movo/shared. Endpoints internos: `hide: true`.

const errorResponse = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        statusCode: { type: "number" },
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

const settlement = {
  type: "object",
  required: [
    "id",
    "shipmentId",
    "holdId",
    "carrierId",
    "mpPaymentId",
    "status",
    "kind",
    "grossAmountArs",
    "mpFeeArs",
    "commissionArs",
    "debtOffsetArs",
    "debtSurchargeArs",
    "carrierGrossAmountArs",
    "carrierMpFeeArs",
    "netAmountArs",
    "failureReason",
    "capturedAt",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: uuid,
    shipmentId: uuid,
    holdId: uuid,
    carrierId: uuid,
    mpPaymentId: { type: "string" },
    status: { type: "string", enum: ["processing", "credited", "failed", "escalated"] },
    kind: { type: "string", enum: ["delivery", "cancellation_penalty", "dispute_partial"] },
    grossAmountArs: { type: "number" },
    mpFeeArs: { type: ["number", "null"] },
    commissionArs: { type: "number" },
    // MOVO-311: deuda cobrada en el envío, aparte de la comisión.
    debtOffsetArs: { type: "number" },
    debtSurchargeArs: { type: "number" },
    carrierGrossAmountArs: { type: "number" },
    carrierMpFeeArs: { type: ["number", "null"] },
    netAmountArs: { type: ["number", "null"] },
    failureReason: {
      type: ["string", "null"],
      enum: ["hold_expired", "carrier_account_unavailable", "provider_error", "unexpected_payment_status", null],
    },
    capturedAt: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

// MOVO-306: sin body es la captura de entrega de MOVO-212. `cancellation_penalty` y
// `dispute_partial` exigen `amountArs`; `delivery` no lo acepta (la entrega siempre cobra lo autorizado).
const captureHoldBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["delivery", "cancellation_penalty", "dispute_partial"], default: "delivery" },
    amountArs: { type: "number", exclusiveMinimum: 0 },
  },
  if: { required: ["kind"], properties: { kind: { enum: ["cancellation_penalty", "dispute_partial"] } } },
  then: { required: ["amountArs"] },
  else: { not: { required: ["amountArs"] } },
} as const;

export const captureHoldSchema = {
  hide: true,
  tags: ["settlements"],
  summary: "Captura el hold de un envío (entrega o penalidad de cancelación) y registra la liquidación (idempotente)",
  description:
    "200 con la liquidación acreditada. Una liquidación ya acreditada se devuelve sin llamar a MP. " +
    "Si la captura falla el hold queda como estaba y la liquidación en `failed`/`processing`. " +
    "`cancellation_penalty` y `dispute_partial` (disputa resuelta en parcial) capturan `amountArs` (MP libera el resto): 422 `CAPTURE_AMOUNT_EXCEEDS_HOLD` si supera " +
    "el hold, 422 `CAPTURE_BELOW_APPLICATION_FEE` si no supera la comisión (el hold sigue `authorized`), " +
    "409 `SETTLEMENT_CONFLICT` si el envío ya tiene una liquidación de otro tipo o monto.",
  params: shipmentIdParams,
  body: captureHoldBody,
  response: {
    200: { type: "object", required: ["settlement"], properties: { settlement } },
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
    502: errorResponse,
  },
} as const;

export const getSettlementSchema = {
  hide: true,
  tags: ["settlements"],
  summary: "Liquidación de un envío",
  params: shipmentIdParams,
  response: { 200: settlement, 404: errorResponse },
} as const;

// MOVO-213 (AC6): liquidaciones pendientes de reintento o escaladas, para el proceso manual.
const settlementIssue = {
  type: "object",
  required: [
    "id", "shipmentId", "carrierId", "holdId", "mpPaymentId", "status", "failureReason", "escalationReason",
    "lastError", "attempts", "nextAttemptAt", "escalatedAt", "holdExpiresAt", "grossAmountArs", "createdAt", "updatedAt",
  ],
  properties: {
    id: uuid,
    shipmentId: uuid,
    carrierId: uuid,
    holdId: uuid,
    mpPaymentId: { type: "string" },
    status: { type: "string", enum: ["failed", "escalated"] },
    failureReason: {
      type: ["string", "null"],
      enum: ["hold_expired", "carrier_account_unavailable", "provider_error", "unexpected_payment_status", null],
    },
    escalationReason: { type: ["string", "null"], enum: ["retries_exhausted", "not_retryable", null] },
    lastError: { type: ["string", "null"] },
    attempts: { type: "integer" },
    nextAttemptAt: { type: ["string", "null"], format: "date-time" },
    escalatedAt: { type: ["string", "null"], format: "date-time" },
    holdExpiresAt: { type: ["string", "null"], format: "date-time" },
    grossAmountArs: { type: "number" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export const listSettlementIssuesSchema = {
  hide: true,
  tags: ["settlements"],
  summary: "Liquidaciones pendientes de reintento (`failed`) o escaladas a proceso manual (`escalated`)",
  description:
    "Las más recientes primero, paginadas con `cursor` opaco. `failed` son entregas con un fallo reintentable que el " +
    "barrido va a reintentar en `nextAttemptAt`; `escalated` las resuelve una persona (se alertó al equipo).",
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["status"],
    properties: {
      status: { type: "string", enum: ["failed", "escalated"] },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      cursor: { type: "string", maxLength: 200 },
    },
  },
  response: {
    200: {
      type: "object",
      required: ["items", "nextCursor"],
      properties: { items: { type: "array", items: settlementIssue }, nextCursor: { type: ["string", "null"] } },
    },
    400: errorResponse,
  },
} as const;
