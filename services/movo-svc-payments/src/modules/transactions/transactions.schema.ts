// Schemas de /payments/transactions (MOVO-303). Reflejan `types/transaction.ts` de @movo/shared;
// el Swagger se genera desde acá.

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

// El hook de `paymentsRoutes` (x-user-id ausente o inválido) responde `{ error: "unauthorized" }`.
const unauthorizedResponse = {
  type: "object",
  properties: { error: { type: "string" } },
} as const;

const uuid = { type: "string", format: "uuid" } as const;
const role = { type: "string", enum: ["sender", "carrier"] } as const;
const status = { type: "string", enum: ["reserved", "completed", "refunded", "disputed", "released"] } as const;

const card = {
  type: ["object", "null"],
  required: ["brand", "last4"],
  properties: { brand: { type: "string" }, last4: { type: ["string", "null"] } },
} as const;

const listItemProperties = {
  id: uuid,
  shipmentId: uuid,
  date: { type: "string", format: "date-time" },
  amountArs: { type: "number" },
  status,
  refundedAmountArs: { type: ["number", "null"] },
  card,
} as const;

const listItem = {
  type: "object",
  required: ["id", "shipmentId", "date", "amountArs", "status", "refundedAmountArs"],
  properties: listItemProperties,
} as const;

const movement = {
  type: "object",
  required: ["kind", "amountArs", "date"],
  properties: {
    kind: { type: "string", enum: ["refund", "chargeback", "mediation"] },
    amountArs: { type: ["number", "null"] },
    date: { type: "string", format: "date-time" },
  },
} as const;

const breakdown = {
  type: ["object", "null"],
  required: ["grossArs", "mpFeeArs", "commissionArs", "debtOffsetArs", "netArs"],
  properties: {
    grossArs: { type: "number" },
    mpFeeArs: { type: "number" },
    commissionArs: { type: "number" },
    // MOVO-311: deuda del transportista descontada de este cobro.
    debtOffsetArs: { type: "number" },
    netArs: { type: "number" },
  },
} as const;

export const listTransactionsSchema = {
  tags: ["transactions"],
  summary: "Historial de transacciones del usuario como emisor (sender) o transportista (carrier)",
  querystring: {
    type: "object",
    required: ["role"],
    properties: {
      role,
      // Uno o varios; el service valida cada valor (también acepta `a,b`) y responde 400.
      status: { type: "array", maxItems: 20, items: { type: "string", maxLength: 100 } },
      from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD, hora de Argentina" },
      to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD inclusivo, hora de Argentina" },
      // MOVO-308: las transacciones de un envío (más de una si hubo reintentos del hold).
      shipmentId: uuid,
      cursor: { type: "string", maxLength: 200 },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    },
  },
  response: {
    200: {
      type: "object",
      required: ["items", "nextCursor"],
      properties: { items: { type: "array", items: listItem }, nextCursor: { type: ["string", "null"] } },
    },
    400: errorResponse,
    401: unauthorizedResponse,
  },
} as const;

export const getTransactionSchema = {
  tags: ["transactions"],
  summary: "Detalle de una transacción (movimientos y, para el transportista, el desglose)",
  params: { type: "object", required: ["id"], properties: { id: uuid } },
  querystring: { type: "object", required: ["role"], properties: { role } },
  response: {
    200: {
      type: "object",
      required: [...listItem.required, "capturedAt", "movements"],
      properties: {
        ...listItemProperties,
        capturedAt: { type: ["string", "null"], format: "date-time" },
        movements: { type: "array", items: movement },
        breakdown,
      },
    },
    400: errorResponse,
    401: unauthorizedResponse,
    404: errorResponse,
  },
} as const;
