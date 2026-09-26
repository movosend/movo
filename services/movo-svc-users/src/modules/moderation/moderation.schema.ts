// Autocontenido a propósito, mismo criterio que el resto de los módulos: los valores
// de enum se duplican como arrays de strings (fuente: `ReportReason`/`ReportStatus`
// de @movo/shared).
const REPORT_REASON_VALUES = ["harassment", "no_show", "damaged_package", "payment_issue", "other"];
const REPORT_STATUS_VALUES = ["pending", "reviewed", "dismissed"];

// `UserReportSummary` de @movo/shared.
const reportObject = {
  type: "object",
  required: ["id", "reportedId", "reason", "details", "status", "createdAt", "entries"],
  properties: {
    id: { type: "string" },
    reportedId: { type: "string" },
    reason: { type: "string", enum: REPORT_REASON_VALUES },
    details: { type: ["string", "null"] },
    status: { type: "string", enum: REPORT_STATUS_VALUES },
    createdAt: { type: "string" },
    entries: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "details", "createdAt"],
        properties: {
          id: { type: "string" },
          details: { type: "string" },
          createdAt: { type: "string" },
        },
      },
    },
  },
};

export const moderationSchemas = {
  userIdParam: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
    },
  },

  reportBody: {
    type: "object",
    required: ["reason"],
    properties: {
      reason: { type: "string", enum: REPORT_REASON_VALUES },
      details: { type: "string", maxLength: 500 },
    },
    additionalProperties: false,
  },

  reportEntryBody: {
    type: "object",
    required: ["details"],
    properties: {
      details: { type: "string", minLength: 1, maxLength: 500 },
    },
    additionalProperties: false,
  },

  reportResponse: reportObject,

  // GET /users/:id/report: `null` es el estado esperado "no tenés un reporte en
  // revisión sobre esta persona" (mismo criterio que `vehicleOrNullResponse`).
  reportOrNullResponse: {
    oneOf: [{ type: "null" }, reportObject],
  },

  blockedListResponse: {
    type: "array",
    items: {
      type: "object",
      required: ["id", "fullName", "photoUrl", "blockedAt"],
      properties: {
        id: { type: "string" },
        fullName: { type: "string" },
        photoUrl: { type: ["string", "null"] },
        blockedAt: { type: "string" },
      },
    },
  },

  // Interno (svc-shipments): unión simétrica de bloqueos. Schema de respuesta
  // obligatorio -- sin él, un cambio de forma del service podía pasar `undefined` al
  // cliente de svc-shipments y dejar pasar una interacción bloqueada en silencio
  // (misma lección que el endpoint interno de MOVO-134).
  blockRelationsResponse: {
    type: "object",
    required: ["userIds"],
    properties: {
      userIds: { type: "array", items: { type: "string" } },
    },
  },

  noContent: { type: "null", description: "Sin contenido" },

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
