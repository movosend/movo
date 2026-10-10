// Schemas de /internal/payments/holds (MOVO-209). Reflejan `types/hold.ts` de
// @movo/shared. Endpoints internos: `hide: true`, no van en la Swagger pública
// (mismo criterio que los `/internal/*` de movo-svc-users).

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

const amountArs = { type: "number", exclusiveMinimum: 0, maximum: 99_999_999.99 } as const;

const shipmentIdParams = {
  type: "object",
  required: ["shipmentId"],
  properties: { shipmentId: uuid },
} as const;

const hold = {
  type: "object",
  required: [
    "id",
    "shipmentId",
    "carrierId",
    "attempt",
    "mpPaymentId",
    "collectorId",
    "amountArs",
    "applicationFeeArs",
    "status",
    "statusDetail",
    "failureReason",
    "expiresAt",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: uuid,
    shipmentId: uuid,
    carrierId: uuid,
    attempt: { type: "integer" },
    mpPaymentId: { type: ["string", "null"] },
    collectorId: { type: "string" },
    amountArs: { type: "number" },
    applicationFeeArs: { type: "number" },
    status: { type: "string", enum: ["creating", "in_process", "authorized", "captured", "cancelled", "rejected"] },
    statusDetail: { type: ["string", "null"] },
    failureReason: {
      type: ["string", "null"],
      enum: ["insufficient_funds", "card_rejected", "invalid_data", "platform_error", null],
    },
    expiresAt: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export const checkoutDataSchema = {
  hide: true,
  tags: ["holds"],
  summary: "Datos para el checkout de un envío: public_key del transportista, monto y comisión",
  body: {
    type: "object",
    required: ["shipmentId", "carrierId", "amountArs", "payerEmail"],
    additionalProperties: false,
    properties: {
      shipmentId: uuid,
      carrierId: uuid,
      amountArs,
      payerEmail: { type: "string", format: "email", maxLength: 254 },
    },
  },
  response: {
    200: {
      type: "object",
      required: ["shipmentId", "publicKey", "amountArs", "applicationFeeArs", "payerEmail"],
      properties: {
        shipmentId: uuid,
        publicKey: { type: "string" },
        amountArs: { type: "number" },
        applicationFeeArs: { type: "number" },
        payerEmail: { type: "string" },
      },
    },
    409: errorResponse,
  },
} as const;

export const createHoldSchema = {
  hide: true,
  tags: ["holds"],
  summary: "Crea el hold (capture: false) de un envío. Idempotente por intento.",
  description:
    "201 si el intento se procesó contra MP (autorizado o rechazado: un rechazo de la tarjeta NO es un " +
    "error HTTP, vuelve con `status: rejected` y `failureReason`). 200 si el envío ya tenía un hold " +
    "vigente y no se llamó a MP.",
  body: {
    type: "object",
    required: ["shipmentId", "carrierId", "cardToken", "amountArs", "payerEmail"],
    additionalProperties: false,
    properties: {
      shipmentId: uuid,
      carrierId: uuid,
      cardToken: { type: "string", minLength: 1, maxLength: 256 },
      amountArs,
      payerEmail: { type: "string", format: "email", maxLength: 254 },
      paymentMethodId: { type: "string", minLength: 1, maxLength: 64 },
    },
  },
  response: { 200: hold, 201: hold, 409: errorResponse, 502: errorResponse },
} as const;

export const getHoldSchema = {
  hide: true,
  tags: ["holds"],
  summary: "Estado del hold más reciente de un envío",
  params: shipmentIdParams,
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      sync: { type: "boolean", default: false, description: "Consulta el pago a MP y actualiza la fila." },
    },
  },
  response: { 200: hold, 404: errorResponse, 502: errorResponse },
} as const;

export const releaseHoldSchema = {
  hide: true,
  tags: ["holds"],
  summary: "Libera el hold de un envío sin capturar (idempotente)",
  params: shipmentIdParams,
  response: { 200: hold, 404: errorResponse, 409: errorResponse, 502: errorResponse },
} as const;
