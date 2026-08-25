// Autocontenido a propósito (no importa de otros *.schema.ts) — mismo criterio que
// shipments.schema.ts: cada schema no comparte definiciones entre sí.

const offerResponse = {
  type: "object",
  required: [
    "id",
    "shipmentId",
    "carrierId",
    "priceOffered",
    "offeredDate",
    "message",
    "carrierRatingAtOffer",
    "carrierNameAtOffer",
    "status",
    "expiresAt",
    "createdAt",
    "respondedAt",
  ],
  properties: {
    id: { type: "string" },
    shipmentId: { type: "string" },
    carrierId: { type: "string" },
    priceOffered: { type: "number" },
    offeredDate: { type: "string", format: "date-time" },
    message: { type: ["string", "null"] },
    carrierRatingAtOffer: { type: ["number", "null"] },
    carrierNameAtOffer: { type: ["string", "null"] },
    status: { type: "string" },
    expiresAt: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    respondedAt: { type: ["string", "null"], format: "date-time" },
  },
};

export const offersSchemas = {
  offerResponse,

  offerIdParam: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
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
