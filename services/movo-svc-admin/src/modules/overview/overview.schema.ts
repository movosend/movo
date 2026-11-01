// Autocontenido a propósito -- mismo criterio que el resto de los *.schema.ts del repo.
const errorOf = {
  type: "object",
  required: ["code", "message"],
  properties: { code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } },
};

const inboxProperties = {
  count: { type: "integer" },
  oldestAt: { type: ["string", "null"], format: "date-time" },
  slaHours: { type: ["number", "null"] },
  overSla: { type: "boolean" },
  yesterdayCount: { type: ["integer", "null"] },
  breakdown: {
    type: "array",
    items: { type: "object", required: ["key", "count"], properties: { key: { type: "string" }, count: { type: "integer" } } },
  },
};
const inboxRequired = Object.keys(inboxProperties);

/** Una bandeja con los contadores propios del bloque, en un `{ data, error }`. `data` nullable: sin eso Fastify serializa mal el `null`. */
const inboxBlock = (extra: readonly string[] = []) => ({
  type: "object",
  required: ["data", "error"],
  properties: {
    data: {
      anyOf: [
        {
          type: "object",
          required: [...inboxRequired, ...extra],
          properties: { ...inboxProperties, ...Object.fromEntries(extra.map((key) => [key, { type: "integer" }])) },
        },
        { type: "null" },
      ],
    },
    error: { anyOf: [errorOf, { type: "null" }] },
  },
});

export const overviewSchemas = {
  query: {
    type: "object",
    additionalProperties: false,
    properties: {
      blocks: { type: "string", maxLength: 200, description: "Lista separada por comas. Sin el parámetro, todos los bloques." },
    },
  },

  response: {
    type: "object",
    required: ["generatedAt", "blocks"],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      // Sin `required`: con `?blocks=` vienen solo los pedidos.
      blocks: {
        type: "object",
        properties: {
          disputes: inboxBlock(["awaitingPayment"]),
          support: inboxBlock(["urgent"]),
          kyc: inboxBlock(["carriers", "senders"]),
          userReports: inboxBlock(["blockRequested"]),
          shipmentAlerts: inboxBlock(["inTransit"]),
          payments: inboxBlock(["holdsExpiringToday"]),
          flaggedMessages: inboxBlock(),
          sanctionsEndingToday: inboxBlock(),
        },
      },
    },
  },

  errorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "statusCode"],
        properties: { code: { type: "string" }, message: { type: "string" }, statusCode: { type: "integer" } },
      },
      requestId: { type: "string" },
    },
  },
};
