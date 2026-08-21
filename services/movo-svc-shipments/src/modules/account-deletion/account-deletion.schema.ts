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
};
