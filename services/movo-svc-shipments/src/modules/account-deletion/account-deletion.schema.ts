// Autocontenido a propósito -- mismo criterio que el resto de los *.schema.ts del repo.
export const accountDeletionSchemas = {
  userIdParam: {
    type: "object",
    required: ["userId"],
    properties: {
      userId: { type: "string", format: "uuid" },
    },
  },

  activeShipmentsResponse: {
    type: "object",
    required: ["hasActiveDispute", "hasActiveShipments"],
    properties: {
      hasActiveDispute: { type: "boolean" },
      hasActiveShipments: { type: "boolean" },
    },
  },

  // MOVO-202/AC7: cantidad de filas borradas -- puramente informativo para el log de
  // svc-users, no una decisión que el caller tome según el número.
  deletedPositionsResponse: {
    type: "object",
    required: ["deletedCount"],
    properties: {
      deletedCount: { type: "integer" },
    },
  },
};
