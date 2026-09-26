// Autocontenido a propósito, mismo criterio que el resto de los módulos: los valores
// de enum se duplican como arrays de strings (fuente: `ReportReason`/`ReportStatus`
// de @movo/shared).
const REPORT_REASON_VALUES = ["harassment", "no_show", "damaged_package", "payment_issue", "other"];
const REPORT_STATUS_VALUES = ["pending", "reviewed", "dismissed"];

// MOVO-256: `MAX_REPORT_PHOTOS_PER_SUBMISSION` de @movo/shared y los límites de
// `moderation.service.ts` (JPEG, 2 MB), duplicados acá por el mismo criterio de arriba.
const MAX_REPORT_PHOTOS = 4;
const MAX_REPORT_PHOTO_BYTES = 2 * 1024 * 1024;

// `UserReportPhoto` de @movo/shared.
const photoArray = {
  type: "array",
  items: {
    type: "object",
    required: ["id", "url", "expiresIn"],
    properties: {
      id: { type: "string" },
      url: { type: "string" },
      expiresIn: { type: "integer" },
    },
  },
};

// Keys devueltas por `POST /users/:id/report/photos/presign`. El prefijo propio, que
// el objeto exista y que no esté ya asociado se validan en el service.
const photoKeysProperty = {
  type: "array",
  maxItems: MAX_REPORT_PHOTOS,
  uniqueItems: true,
  items: { type: "string", minLength: 1, maxLength: 256 },
};

// `UserReportSummary` de @movo/shared.
const reportObject = {
  type: "object",
  required: ["id", "reportedId", "reason", "details", "status", "createdAt", "photos", "entries"],
  properties: {
    id: { type: "string" },
    reportedId: { type: "string" },
    reason: { type: "string", enum: REPORT_REASON_VALUES },
    details: { type: ["string", "null"] },
    status: { type: "string", enum: REPORT_STATUS_VALUES },
    createdAt: { type: "string" },
    photos: photoArray,
    entries: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "details", "createdAt", "photos"],
        properties: {
          id: { type: "string" },
          details: { type: ["string", "null"] },
          createdAt: { type: "string" },
          photos: photoArray,
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
      photoKeys: photoKeysProperty,
    },
    additionalProperties: false,
  },

  // MOVO-256: texto, fotos o ambos -- "al menos uno de los dos" se valida en el service.
  reportEntryBody: {
    type: "object",
    properties: {
      details: { type: "string", maxLength: 500 },
      photoKeys: photoKeysProperty,
    },
    additionalProperties: false,
  },

  reportPhotoUploadBody: {
    type: "object",
    required: ["contentType", "contentLength"],
    properties: {
      contentType: { type: "string", enum: ["image/jpeg"] },
      contentLength: { type: "integer", minimum: 1, maximum: MAX_REPORT_PHOTO_BYTES },
    },
    additionalProperties: false,
  },

  reportPhotoUploadResponse: {
    type: "object",
    required: ["uploadUrl", "s3Key", "expiresIn"],
    properties: {
      uploadUrl: { type: "string" },
      s3Key: { type: "string" },
      expiresIn: { type: "integer" },
    },
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
