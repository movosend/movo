// Autocontenido a propósito -- mismo criterio que el resto de los *.schema.ts del repo.
const TARGET_TYPES = ["user", "admin_role", "shipment", "chat_report", "user_report"];

export const AUDIT_LOG_PAGE_MAX_LIMIT = 50;

export const auditSchemas = {
  listQuery: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminId: { type: "string", format: "uuid" },
      action: { type: "string", minLength: 1, maxLength: 100 },
      targetType: { type: "string", enum: TARGET_TYPES },
      // 254 = largo máximo de un email, que es el objetivo de una fila `admin_role.grant` fallida.
      targetId: { type: "string", minLength: 1, maxLength: 254 },
      limit: { type: "integer", minimum: 1, maximum: AUDIT_LOG_PAGE_MAX_LIMIT, default: 20 },
      cursor: { type: "string", minLength: 1, maxLength: 200 },
    },
  },

  listResponse: {
    type: "object",
    required: ["items", "nextCursor"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          required: [
            "id",
            "adminId",
            "action",
            "targetType",
            "targetId",
            "reason",
            "context",
            "outcome",
            "errorCode",
            "requestId",
            "createdAt",
          ],
          properties: {
            id: { type: "string" },
            adminId: { type: "string" },
            action: { type: "string" },
            targetType: { type: "string", enum: TARGET_TYPES },
            targetId: { type: "string" },
            reason: { type: ["string", "null"] },
            context: { type: ["object", "null"], additionalProperties: true },
            outcome: { type: "string", enum: ["succeeded", "failed", "unknown"] },
            errorCode: { type: ["string", "null"] },
            requestId: { type: ["string", "null"] },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
      nextCursor: { type: ["string", "null"] },
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
