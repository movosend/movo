// Autocontenido a propósito -- mismo criterio que el resto de los *.schema.ts del repo.
const uuid = { type: "string", format: "uuid" } as const;
const nullableUuid = { type: ["string", "null"], format: "uuid" } as const;

export const adminInternalSchemas = {
  idParam: {
    type: "object",
    required: ["id"],
    properties: { id: uuid },
  },

  shipmentPartiesResponse: {
    type: "object",
    required: ["shipmentId", "senderId", "carrierId", "receiverId", "formerReceiverIds"],
    properties: {
      shipmentId: uuid,
      senderId: uuid,
      carrierId: nullableUuid,
      receiverId: nullableUuid,
      formerReceiverIds: { type: "array", items: uuid },
    },
  },

  chatReportPartiesResponse: {
    type: "object",
    required: ["reportId", "shipmentId", "reporterId", "partyIds"],
    properties: {
      reportId: uuid,
      shipmentId: uuid,
      reporterId: uuid,
      partyIds: { type: "array", items: uuid },
    },
  },
};
