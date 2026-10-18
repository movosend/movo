// Schemas de "Pagar mi saldo" (MOVO-312). Reflejan `types/user-ledger.ts` de @movo/shared; el Swagger se genera desde acá.
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

export const balancePayDataSchema = {
  tags: ["payments"],
  summary: "Pagar mi saldo: datos para tokenizar la tarjeta",
  description:
    "Devuelve la `public_key` de la cuenta cobradora de Movo (con ella la app genera el token con `card_id` + CVV) y " +
    "el saldo deudor, que es el máximo que se puede pagar. 422 si no hay deuda.",
  response: {
    200: {
      type: "object",
      required: ["publicKey", "balanceArs"],
      properties: { publicKey: { type: "string" }, balanceArs: { type: "number" } },
    },
    401: unauthorizedResponse,
    422: errorResponse,
    503: errorResponse,
  },
} as const;

export const balancePaySchema = {
  tags: ["payments"],
  summary: "Pagar mi saldo con una tarjeta guardada + CVV",
  description:
    "Cobra `amountArs` (no más que el saldo deudor) a la tarjeta guardada con un pago directo a la cuenta cobradora de " +
    "Movo, sin salir de la app. Un rechazo de la tarjeta NO es un error HTTP: responde 200 con `status: rejected` y el " +
    "motivo. `pending`: MP todavía no resolvió y el saldo se actualiza solo con el webhook. Dos pedidos iguales en " +
    "vuelo comparten un único pago.",
  body: {
    type: "object",
    required: ["amountArs", "cardToken", "savedCardId"],
    additionalProperties: false,
    properties: {
      amountArs: { type: "number", exclusiveMinimum: 0, maximum: 10000000 },
      cardToken: { type: "string", minLength: 1, maxLength: 200 },
      savedCardId: { type: "string", format: "uuid" },
      paymentMethodId: { type: "string", minLength: 1, maxLength: 50 },
    },
  },
  response: {
    200: {
      type: "object",
      required: ["attemptId", "status", "failureReason", "balanceArs"],
      properties: {
        attemptId: { type: "string", format: "uuid" },
        status: { type: "string", enum: ["approved", "rejected", "pending"] },
        failureReason: {
          type: "string",
          nullable: true,
          enum: ["insufficient_funds", "card_rejected", "invalid_data", "platform_error", null],
        },
        balanceArs: { type: "number" },
      },
    },
    400: errorResponse,
    401: unauthorizedResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
    502: errorResponse,
    503: errorResponse,
  },
} as const;
