// Autocontenido a propósito (no importa de otros *.schema.ts) -- mismo criterio que
// handshake.schema.ts/ratings.schema.ts.

const shipmentIdParam = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", format: "uuid" },
  },
};

// AC1: lat/lng/accuracy_m/captured_at -- shipment_id/recorded_at los resuelve el
// servidor (path param y `new Date()` respectivamente), nunca el body.
const reportPositionBody = {
  type: "object",
  required: ["lat", "lng", "accuracyM", "capturedAt"],
  properties: {
    lat: { type: "number", minimum: -90, maximum: 90 },
    lng: { type: "number", minimum: -180, maximum: 180 },
    accuracyM: { type: "number", minimum: 0 },
    capturedAt: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
};

const reportPositionResponse = {
  type: "object",
  required: ["persisted"],
  properties: {
    // Diagnóstico para el cliente: si esta posición puntual cayó dentro de la
    // cadencia de ~45s (AC4) y se persistió en Postgres, o si solo actualizó la
    // última posición conocida (AC3) y se difundió (AC5) sin tocar la base.
    persisted: { type: "boolean" },
  },
};

export const positionsSchemas = {
  shipmentIdParam,
  reportPositionBody,
  reportPositionResponse,
};
