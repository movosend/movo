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

export const createBalanceCheckoutSchema = {
  tags: ["payments"],
  summary: "Pagar mi saldo: crea el checkout de Mercado Pago para saldar deuda",
  description:
    "Crea una preferencia de Checkout Pro (Movo como cobrador) por el monto pedido, que no puede superar el saldo " +
    "deudor. Devuelve el `checkoutUrl` para abrir en un navegador embebido. Dos pedidos iguales en vuelo comparten " +
    "el mismo checkout. El resultado no se confía del redirect: la app vuelve a pedir `GET /payments/balance`.",
  body: {
    type: "object",
    required: ["amountArs"],
    additionalProperties: false,
    properties: { amountArs: { type: "number", exclusiveMinimum: 0, maximum: 10000000 } },
  },
  response: {
    200: {
      type: "object",
      required: ["checkoutUrl", "attemptId"],
      properties: { checkoutUrl: { type: "string" }, attemptId: { type: "string", format: "uuid" } },
    },
    400: errorResponse,
    401: unauthorizedResponse,
    409: errorResponse,
    422: errorResponse,
    502: errorResponse,
    503: errorResponse,
  },
} as const;
