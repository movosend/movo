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
  required: ["shipmentId", "role", "status", "paidAmountArs", "paidAt", "debtCollectedArs"],
  properties: {
    shipmentId: { type: "string", format: "uuid" },
    role: { type: "string", enum: ["sender", "carrier"] },
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

export const settlementSchemas = { errorResponse, shipmentIdParam, settlementResponse };
