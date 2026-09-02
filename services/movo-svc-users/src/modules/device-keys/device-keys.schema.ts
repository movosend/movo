// Autocontenido a propósito, mismo criterio que el resto de los módulos.
export const deviceKeysSchemas = {
  userIdParam: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
    },
  },

  // AC3: la clave pública vigente del usuario, resuelta por `svc-shipments` al
  // validar un handshake (MOVO-158).
  deviceKeyResponse: {
    type: "object",
    required: ["publicKey", "registeredAt"],
    properties: {
      publicKey: { type: "string" },
      registeredAt: { type: "string", format: "date-time" },
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
