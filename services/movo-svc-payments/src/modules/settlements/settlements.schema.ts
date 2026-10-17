// Schemas de /internal/payments (captura y liquidación, MOVO-212). Reflejan
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

export const captureHoldSchema = {
  hide: true,
  tags: ["settlements"],
  summary: "Captura el hold de un envío entregado y registra la liquidación (idempotente)",
  description:
    "200 con la liquidación acreditada. Una liquidación ya acreditada se devuelve sin llamar a MP. " +
    "Si la captura falla el hold queda como estaba y la liquidación en `failed`/`processing`.",
  params: shipmentIdParams,
  response: {
    200: { type: "object", required: ["settlement"], properties: { settlement } },
    404: errorResponse,
    409: errorResponse,
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
