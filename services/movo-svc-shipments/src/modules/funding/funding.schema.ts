// Autocontenido a propósito (no importa de otros *.schema.ts) -- mismo criterio que
// offers.schema.ts / shipments.schema.ts. Refleja `types/funding.ts` de @movo/shared.

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

const HOLD_FAILURE_REASONS = ["insufficient_funds", "card_rejected", "invalid_data", "platform_error"];

export const fundingSchemas = {
  errorResponse,
  shipmentIdParam,

  fundingResponse: {
    type: "object",
    required: ["shipmentId", "route", "carrierPublicKey", "amountArs", "payUntil"],
    properties: {
      shipmentId: { type: "string" },
      route: { type: "string", enum: ["near", "far"] },
      carrierPublicKey: { type: "string" },
      amountArs: { type: "number" },
      payUntil: { type: "string" },
    },
  },

  fundingBody: {
    type: "object",
    required: ["cardToken"],
    additionalProperties: false,
    properties: {
      cardToken: { type: "string", minLength: 1, maxLength: 256 },
      paymentMethodId: { type: "string", minLength: 1, maxLength: 64 },
    },
  },

  fundingResult: {
    type: "object",
    required: ["shipmentId", "funded", "shipmentStatus", "failureReason", "payUntil"],
    properties: {
      shipmentId: { type: "string" },
      funded: { type: "boolean" },
      shipmentStatus: { type: "string" },
      failureReason: { type: ["string", "null"], enum: [...HOLD_FAILURE_REASONS, null] },
      payUntil: { type: ["string", "null"] },
    },
  },

  holdEventBody: {
    type: "object",
    required: ["holdId", "event"],
    additionalProperties: false,
    properties: {
      holdId: { type: "string", format: "uuid" },
      event: { type: "string", enum: ["cancelled", "expired", "rejected"] },
      statusDetail: { type: ["string", "null"], maxLength: 256 },
    },
  },

  holdEventResponse: {
    type: "object",
    required: ["handled", "outcome"],
    properties: {
      handled: { type: "boolean" },
      outcome: { type: "string" },
    },
  },
} as const;
