// Autocontenido a propósito -- mismo criterio que el resto de los *.schema.ts del repo.
const adminSummary = {
  type: "object",
  required: ["id", "fullName", "email", "status", "grantedAt"],
  properties: {
    id: { type: "string" },
    fullName: { type: "string" },
    email: { type: "string" },
    status: { type: "string", enum: ["active", "banned", "deleted"] },
    grantedAt: { type: "string" },
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

export const REVOKE_REASON_MIN_LENGTH = 3;
export const REVOKE_REASON_MAX_LENGTH = 500;

export const adminsSchemas = {
  errorResponse,
  listResponse: { type: "array", items: adminSummary },
  adminSummary,
  grantBody: {
    type: "object",
    required: ["email"],
    additionalProperties: false,
    properties: { email: { type: "string", minLength: 3, maxLength: 254 } },
  },
  revokeParams: {
    type: "object",
    required: ["userId"],
    properties: { userId: { type: "string", format: "uuid" } },
  },
  revokeBody: {
    type: "object",
    required: ["reason"],
    additionalProperties: false,
    properties: { reason: { type: "string", minLength: REVOKE_REASON_MIN_LENGTH, maxLength: REVOKE_REASON_MAX_LENGTH } },
  },
};
