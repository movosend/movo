import { TOUR_IDS, TOUR_OUTCOMES } from "@movo/shared";

// Autocontenido a propósito, mismo criterio que el resto de los módulos.
const tourRecord = {
  type: "object",
  required: ["tourId", "version", "outcome"],
  properties: {
    tourId: { type: "string", enum: [...TOUR_IDS] },
    version: { type: "integer" },
    outcome: { type: "string", enum: [...TOUR_OUTCOMES] },
  },
};

export const toursSchemas = {
  tourRecord,

  tourIdParam: {
    type: "object",
    required: ["tourId"],
    properties: {
      tourId: { type: "string", enum: [...TOUR_IDS] },
    },
  },

  recordBody: {
    type: "object",
    required: ["version", "outcome"],
    properties: {
      // Tope del `Int` de Postgres (columna `version`): más allá sería un 500 de Prisma.
      version: { type: "integer", minimum: 1, maximum: 2147483647 },
      outcome: { type: "string", enum: [...TOUR_OUTCOMES] },
    },
    additionalProperties: false,
  },

  errorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "statusCode"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          statusCode: { type: "integer" },
        },
      },
      requestId: { type: "string" },
    },
  },
};
