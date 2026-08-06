// Autocontenido a propósito (no importa de auth.schema.ts) — mismo criterio que ya usa
// el resto de los módulos: cada *.schema.ts no comparte definiciones entre sí.
const KYC_STATUS_VALUES = ["not_started", "pending", "approved", "rejected", "expired", "manual_review"];

export const kycSchemas = {
  kycSessionBody: {
    type: "object",
    additionalProperties: false,
    required: ["userId"],
    properties: {
      // Sin JWT (MOVO-94 hace seguimiento de esta decisión): el usuario todavía no
      // tiene token en este punto del onboarding (register no emite tokens).
      userId: { type: "string", format: "uuid" },
    },
  },
  kycSessionResponse: {
    type: "object",
    required: ["sessionId", "sessionToken"],
    properties: {
      sessionId: { type: "string" },
      sessionToken: { type: "string" },
    },
  },
  kycStatusQuerystring: {
    type: "object",
    additionalProperties: false,
    required: ["userId"],
    properties: {
      userId: { type: "string", format: "uuid" },
    },
  },
  kycStatusResponse: {
    type: "object",
    required: ["status"],
    properties: {
      status: { type: "string", enum: KYC_STATUS_VALUES },
      manualReviewReason: { type: ["string", "null"] },
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
