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

// MOVO-250/AC4: máximo de posiciones por lote (sugerido 100 por el ticket).
export const MAX_POSITIONS_PER_BATCH = 100;

const batchPositionItem = {
  type: "object",
  required: ["shipmentId", "lat", "lng", "accuracyM", "capturedAt"],
  properties: {
    shipmentId: { type: "string", format: "uuid" },
    ...reportPositionBody.properties,
  },
  additionalProperties: false,
};

const reportPositionsBatchBody = {
  type: "object",
  required: ["positions"],
  properties: {
    positions: { type: "array", minItems: 1, maxItems: MAX_POSITIONS_PER_BATCH, items: batchPositionItem },
  },
  additionalProperties: false,
};

// Un resultado por ítem, en el orden del request (`index` lo repite igual). Objeto plano
// con `persisted`/`code` opcionales en vez de un oneOf, que fast-json-stringify serializa
// mal: `accepted` trae `persisted`, `rejected` trae `code`.
const reportPositionsBatchResponse = {
  type: "object",
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["index", "shipmentId", "status"],
        properties: {
          index: { type: "integer" },
          shipmentId: { type: "string" },
          status: { type: "string", enum: ["accepted", "rejected"] },
          persisted: { type: "boolean" },
          code: {
            type: "string",
            enum: [
              "SHIPMENT_NOT_TRACKABLE",
              "SHIPMENT_NOT_IN_TRANSIT",
              "NOT_FOUND",
              "FORBIDDEN",
              "INVALID_CAPTURED_AT",
            ],
          },
        },
      },
    },
  },
};

export const positionsSchemas = {
  shipmentIdParam,
  reportPositionBody,
  reportPositionResponse,
  reportPositionsBatchBody,
  reportPositionsBatchResponse,
};
