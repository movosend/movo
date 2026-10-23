// Autocontenido a propósito (no importa de otros *.schema.ts) -- mismo criterio que
// funding.schema.ts. Refleja `ShipmentSettlementResponse` de @movo/shared.

const errorResponse = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        statusCode: { type: "number" },
      },
    },
    requestId: { type: "string" },
  },
} as const;

const shipmentIdParam = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

// `mpFeeArs`/`commissionArs`/`netAmountArs` son opcionales a propósito: el emisor NO los
// recibe (AC10), y el serializador de Fastify descarta cualquier campo que no figure acá.
const settlementResponse = {
  type: "object",
  required: ["shipmentId", "role", "kind", "status", "paidAmountArs", "paidAt", "debtCollectedArs"],
  properties: {
    shipmentId: { type: "string", format: "uuid" },
    role: { type: "string", enum: ["sender", "carrier"] },
    // MOVO-307: `cancellation_penalty` = penalidad de una cancelación tardía (el emisor pagó
    // la penalidad, el transportista recibe la compensación); `delivery` = cobro del envío.
    kind: { type: "string", enum: ["delivery", "cancellation_penalty"] },
    status: { type: "string", enum: ["processing", "credited", "escalated"] },
    paidAmountArs: { type: "number" },
    paidAt: { type: ["string", "null"], format: "date-time" },
    // MOVO-311: deuda de la cuenta corriente de quien consulta saldada en este envío.
    debtCollectedArs: { type: "number" },
    mpFeeArs: { type: ["number", "null"] },
    commissionArs: { type: "number" },
    netAmountArs: { type: ["number", "null"] },
  },
} as const;

// MOVO-213: aviso interno de svc-payments sobre la liquidación (`SettlementEventRequest` de @movo/shared).
const settlementEventBody = {
  type: "object",
  required: ["event"],
  additionalProperties: false,
  properties: { event: { type: "string", enum: ["delayed", "credited"] } },
} as const;

const settlementEventResponse = {
  type: "object",
  required: ["handled", "outcome"],
  properties: { handled: { type: "boolean" }, outcome: { type: "string" } },
} as const;

export const settlementSchemas = {
  errorResponse,
  shipmentIdParam,
  settlementResponse,
  settlementEventBody,
  settlementEventResponse,
};
