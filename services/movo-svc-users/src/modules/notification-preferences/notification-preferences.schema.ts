// Autocontenido a propósito, mismo criterio que el resto de los módulos.
export const notificationPreferencesSchemas = {
  updateBody: {
    type: "object",
    properties: {
      pushEnabled: { type: "boolean" },
      quietHours: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          from: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
          to: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
        },
        additionalProperties: false,
      },
      // `additionalProperties: true`: la validación real de qué ids son válidos pasa
      // por `IMPLEMENTED_NOTIFICATION_CATEGORY_IDS` en el service (400
      // VALIDATION_FAILED) -- acá solo se exige que cada valor sea boolean.
      categories: {
        type: "object",
        additionalProperties: { type: "boolean" },
      },
    },
    additionalProperties: false,
  },

  preferencesResponse: {
    type: "object",
    required: ["pushEnabled", "quietHours", "categories"],
    properties: {
      pushEnabled: { type: "boolean" },
      quietHours: {
        type: "object",
        required: ["enabled", "from", "to"],
        properties: {
          enabled: { type: "boolean" },
          from: { type: "string" },
          to: { type: "string" },
        },
      },
      categories: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "enabled"],
          properties: {
            id: { type: "string" },
            enabled: { type: "boolean" },
          },
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
