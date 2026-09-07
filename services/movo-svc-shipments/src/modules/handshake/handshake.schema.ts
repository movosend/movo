// Autocontenido a propósito (no importa de otros *.schema.ts) -- mismo criterio que el
// resto del repo (ver ratings.schema.ts).

const HANDSHAKE_STAGE_VALUES = ["pickup", "delivery"];
const SHIPMENT_STATUS_VALUES = [
  "awaiting_receiver_confirmation",
  "rejected_by_receiver",
  "published",
  "assignment_pending",
  "assigned",
  "in_transit",
  "delivered",
  "cancelled",
  "disputed",
];

const shipmentIdParam = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", format: "uuid" },
  },
};

const generateHandshakeBody = {
  type: "object",
  required: ["lat", "lng"],
  properties: {
    lat: { type: "number", minimum: -90, maximum: 90 },
    lng: { type: "number", minimum: -180, maximum: 180 },
  },
  additionalProperties: false,
};

const generateHandshakeResponse = {
  type: "object",
  required: ["shipmentId", "stage", "nonce", "canonicalPayload", "expiresAt", "ttlSeconds"],
  properties: {
    shipmentId: { type: "string" },
    stage: { type: "string", enum: HANDSHAKE_STAGE_VALUES },
    nonce: { type: "string" },
    canonicalPayload: { type: "string" },
    expiresAt: { type: "string", format: "date-time" },
    ttlSeconds: { type: "integer" },
  },
};

const confirmHandshakeBody = {
  type: "object",
  required: ["nonce", "signature", "lat", "lng"],
  properties: {
    nonce: { type: "string", minLength: 1 },
    signature: { type: "string", minLength: 1 },
    lat: { type: "number", minimum: -90, maximum: 90 },
    lng: { type: "number", minimum: -180, maximum: 180 },
  },
  additionalProperties: false,
};

const confirmHandshakeResponse = {
  type: "object",
  required: ["shipmentId", "stage", "previousStatus", "status", "distanceM", "confirmedAt"],
  properties: {
    shipmentId: { type: "string" },
    stage: { type: "string", enum: HANDSHAKE_STAGE_VALUES },
    previousStatus: { type: "string", enum: SHIPMENT_STATUS_VALUES },
    status: { type: "string", enum: SHIPMENT_STATUS_VALUES },
    distanceM: { type: "number" },
    confirmedAt: { type: "string", format: "date-time" },
  },
};

const errorResponse = {
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
};

export const handshakeSchemas = {
  shipmentIdParam,
  generateHandshakeBody,
  generateHandshakeResponse,
  confirmHandshakeBody,
  confirmHandshakeResponse,
  errorResponse,
};
