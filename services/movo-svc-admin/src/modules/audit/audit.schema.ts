// Autocontenido a propósito -- mismo criterio que el resto de los *.schema.ts del repo.
// Los valores de `AdminTargetType` (@movo/shared): uno que falte acá responde 400 al filtrar por él.
const TARGET_TYPES = ["user", "admin_role", "shipment", "chat_report", "user_report", "support_conversation", "dispute", "report"];

export const AUDIT_LOG_PAGE_MAX_LIMIT = 50;

/** Filtros comunes del listado y de la exportación (MOVO-342: el CSV usa exactamente los mismos). */
const filterProperties = {
  adminId: { type: "string", format: "uuid" },
  action: { type: "string", minLength: 1, maxLength: 100 },
  targetType: { type: "string", enum: TARGET_TYPES },
  // 254 = largo máximo de un email, que es el objetivo de una fila `admin_role.grant` fallida.
  targetId: { type: "string", minLength: 1, maxLength: 254 },
  // Días `YYYY-MM-DD` de Argentina, inclusivos; el largo y el orden los valida `validateReportRange` (400 `REPORT_RANGE_INVALID`).
  from: { type: "string", format: "date" },
  to: { type: "string", format: "date" },
} as const;

export const auditSchemas = {
  listQuery: {
    type: "object",
    additionalProperties: false,
    properties: {
      ...filterProperties,
      limit: { type: "integer", minimum: 1, maximum: AUDIT_LOG_PAGE_MAX_LIMIT, default: 20 },
      cursor: { type: "string", minLength: 1, maxLength: 200 },
    },
  },

  exportQuery: {
    type: "object",
    additionalProperties: false,
    properties: filterProperties,
  },

  exportResponse: {
    type: "string",
    description: "CSV (UTF-8 con BOM, CRLF), una fila por entrada de la bitácora en el orden del listado.",
  },

  listResponse: {
    type: "object",
    required: ["items", "nextCursor", "admins", "targets"],
    properties: {
      admins: {
        type: "object",
        description: "id → nombre. Falta la clave si `svc-users` no respondió.",
        additionalProperties: { type: "object", required: ["fullName"], properties: { fullName: { type: "string" } } },
      },
      targets: {
        type: "object",
        description: "`tipo:id` → etiqueta y relación del objetivo. Falta la clave si el servicio dueño no respondió.",
        additionalProperties: {
          type: "object",
          required: ["label"],
          properties: { label: { type: ["string", "null"] }, shipmentId: { type: "string" }, userId: { type: "string" } },
        },
      },
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
          details: { type: "object", additionalProperties: true },
        },
      },
      requestId: { type: "string" },
    },
  },
};
