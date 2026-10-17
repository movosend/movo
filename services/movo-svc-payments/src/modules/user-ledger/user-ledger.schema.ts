// Schemas de la cuenta corriente del usuario (MOVO-309). Reflejan `types/user-ledger.ts` de
// @movo/shared; el Swagger se genera desde acá. Las rutas internas van con `hide: true`.
// Los decimales del monto los valida el service (Ajv compara en float, `multipleOf` falla).

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

const unauthorizedResponse = { type: "object", properties: { error: { type: "string" } } } as const;

const uuid = { type: "string", format: "uuid" } as const;
const amount = { type: "number", minimum: -10000000, maximum: 10000000 } as const;
const idempotencyKey = { type: "string", minLength: 8, maxLength: 200 } as const;

const entryTypes = [
  "cancellation_penalty",
  "penalty_capture",
  "cash_commission",
  "fee_offset",
  "payment_surcharge",
  "voluntary_payment",
  "manual_adjustment",
] as const;
const entryStatuses = ["pending", "reserved", "settled", "voided"] as const;

const entry = {
  type: "object",
  required: ["id", "userId", "roleAtOrigin", "type", "amountArs", "status", "shipmentId", "holdId", "paymentId", "reason", "createdAt"],
  properties: {
    id: uuid,
    userId: uuid,
    roleAtOrigin: { type: ["string", "null"], enum: ["sender", "carrier", null] },
    type: { type: "string", enum: entryTypes },
    amountArs: { type: "number" },
    status: { type: "string", enum: entryStatuses },
    shipmentId: { type: ["string", "null"] },
    holdId: { type: ["string", "null"] },
    paymentId: { type: ["string", "null"] },
    reason: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    originLabel: { type: ["string", "null"] },
  },
} as const;

const balanceProperties = {
  balanceArs: { type: "number" },
  oldestUnpaidAt: { type: ["string", "null"], format: "date-time" },
} as const;

const userIdParams = { type: "object", required: ["userId"], properties: { userId: uuid } } as const;

export const getBalanceInternalSchema = {
  hide: true,
  params: userIdParams,
  response: {
    200: { type: "object", required: ["balanceArs", "oldestUnpaidAt"], properties: balanceProperties },
    400: errorResponse,
  },
} as const;

// MOVO-311: vista previa del descuento por deuda al transportista, para el "Recibís aprox." de sus ofertas.
export const debtCollectionPreviewInternalSchema = {
  hide: true,
  params: userIdParams,
  body: {
    type: "object",
    required: ["amountsArs"],
    additionalProperties: false,
    properties: {
      amountsArs: { type: "array", maxItems: 100, items: { type: "number", minimum: 0.01, maximum: 99_999_999.99 } },
    },
  },
  response: {
    200: {
      type: "object",
      required: ["pendingBalanceArs", "debtOffsetsArs"],
      properties: {
        pendingBalanceArs: { type: "number" },
        debtOffsetsArs: { type: "array", items: { type: "number" } },
      },
    },
    400: errorResponse,
  },
} as const;

export const debtCollectionPreviewSchema = {
  tags: ["payments"],
  summary: "Vista previa del descuento por deuda del transportista",
  body: debtCollectionPreviewInternalSchema.body,
  response: { ...debtCollectionPreviewInternalSchema.response, 401: unauthorizedResponse },
} as const;

export const createEntryInternalSchema = {
  hide: true,
  params: userIdParams,
  body: {
    type: "object",
    required: ["idempotencyKey", "type", "amountArs"],
    additionalProperties: false,
    properties: {
      idempotencyKey,
      type: { type: "string", enum: entryTypes.filter((t) => t !== "manual_adjustment") },
      roleAtOrigin: { type: "string", enum: ["sender", "carrier"] },
      amountArs: amount,
      status: { type: "string", enum: ["pending", "reserved", "settled"] },
      shipmentId: uuid,
      holdId: uuid,
      paymentId: { type: "string", minLength: 1, maxLength: 100 },
    },
  },
  response: {
    200: { type: "object", required: ["entry", "created"], properties: { entry, created: { type: "boolean" } } },
    201: { type: "object", required: ["entry", "created"], properties: { entry, created: { type: "boolean" } } },
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
} as const;

export const manualAdjustmentInternalSchema = {
  hide: true,
  params: userIdParams,
  body: {
    type: "object",
    required: ["idempotencyKey", "amountArs", "reason", "adminId"],
    additionalProperties: false,
    properties: {
      idempotencyKey,
      amountArs: amount,
      reason: { type: "string", minLength: 1, maxLength: 500 },
      adminId: uuid,
      shipmentId: uuid,
    },
  },
  response: createEntryInternalSchema.response,
} as const;

export const getBalanceSchema = {
  tags: ["payments"],
  summary: "Mi cuenta corriente: saldo y movimientos",
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      cursor: { type: "string", minLength: 1, maxLength: 200 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
  },
  response: {
    200: {
      type: "object",
      required: ["balanceArs", "oldestUnpaidAt", "items", "nextCursor"],
      properties: {
        ...balanceProperties,
        items: { type: "array", items: { ...entry, required: [...entry.required, "originLabel"] } },
        nextCursor: { type: ["string", "null"] },
      },
    },
    400: errorResponse,
    401: unauthorizedResponse,
  },
} as const;
