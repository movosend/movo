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
        // `HOLD_AMOUNT_CHANGED` trae el total actual en `details.totalArs`.
        details: { type: "object", additionalProperties: true },
      },
    },
    requestId: { type: "string" },
  },
} as const;

const uuid = { type: "string", format: "uuid" } as const;

// Mínimo de un centavo. Los decimales de más NO se validan con `multipleOf`: Ajv compara
// en punto flotante y rechaza montos válidos (0.07 / 0.01 no es entero en JS). Lo hace
// `assertValidAmount` en el service, que responde 400 VALIDATION_FAILED.
const amountArs = { type: "number", minimum: 0.01, maximum: 99_999_999.99 } as const;

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
    "baseAmountArs",
    "commissionArs",
    "debtOffsetArs",
    "debtSurchargeArs",
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
    // MOVO-311: desglose de la deuda que cobra el hold.
    baseAmountArs: { type: "number" },
    commissionArs: { type: "number" },
    debtOffsetArs: { type: "number" },
    debtSurchargeArs: { type: "number" },
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
  description:
    "Con `payerUserId`, el monto incluye la deuda de la cuenta corriente del emisor y la comisión la del " +
    "transportista, con el tope por envío (MOVO-311). Es una vista previa: no reserva nada.",
  body: {
    type: "object",
    required: ["shipmentId", "carrierId", "amountArs", "payerEmail"],
    additionalProperties: false,
    properties: {
      shipmentId: uuid,
      carrierId: uuid,
      amountArs,
      payerEmail: { type: "string", format: "email", maxLength: 254 },
      // MOVO-311: el emisor, para sumar su deuda al pago.
      payerUserId: uuid,
    },
  },
  response: {
    200: {
      type: "object",
      required: [
        "shipmentId",
        "publicKey",
        "amountArs",
        "applicationFeeArs",
        "baseAmountArs",
        "debtOffsetArs",
        "debtSurchargeArs",
        "payerEmail",
      ],
      properties: {
        shipmentId: uuid,
        publicKey: { type: "string" },
        amountArs: { type: "number" },
        applicationFeeArs: { type: "number" },
        baseAmountArs: { type: "number" },
        debtOffsetArs: { type: "number" },
        debtSurchargeArs: { type: "number" },
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
    "vigente y no se llamó a MP. Con `savedCardId` el pagador es el customer de esa tarjeta guardada " +
    "(tiene que ser de `payerUserId` y estar viva; si no, 404).",
  body: {
    type: "object",
    required: ["shipmentId", "carrierId", "cardToken", "amountArs", "payerEmail", "payerUserId"],
    additionalProperties: false,
    properties: {
      shipmentId: uuid,
      carrierId: uuid,
      cardToken: { type: "string", minLength: 1, maxLength: 256 },
      amountArs,
      payerEmail: { type: "string", format: "email", maxLength: 254 },
      // MOVO-282: el emisor y, opcional, la tarjeta guardada con la que se generó el token.
      payerUserId: uuid,
      savedCardId: uuid,
      paymentMethodId: { type: "string", minLength: 1, maxLength: 64 },
      // MOVO-311: el total que el emisor confirmó; si cambió su deuda, 409 `HOLD_AMOUNT_CHANGED`.
      expectedTotalArs: amountArs,
    },
  },
  response: { 200: hold, 201: hold, 404: errorResponse, 409: errorResponse, 502: errorResponse },
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
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: { expectedCarrierId: uuid, expectedHoldId: uuid },
  },
  response: { 200: hold, 404: errorResponse, 409: errorResponse, 502: errorResponse },
} as const;
