// Autocontenido a propósito (no importa de otros *.schema.ts) -- mismo criterio que el
// resto del repo (ver shipments.schema.ts).

const RATING_ROLE_VALUES = ["sender", "carrier", "receiver"];

// AC4: entero 1..5, sin medias estrellas.
const SCORE_MIN = 1;
const SCORE_MAX = 5;

// Mismo límite que `description`/`reason` en shipments.schema.ts, sin un AC que pida
// uno específico.
const COMMENT_MAX_LENGTH = 500;

const DEFAULT_RECENT_RATINGS_LIMIT = 10;
const MAX_RECENT_RATINGS_LIMIT = 50;

const ratingResponse = {
  type: "object",
  required: ["id", "shipmentId", "raterId", "rateeId", "role", "score", "comment", "createdAt"],
  properties: {
    id: { type: "string" },
    shipmentId: { type: "string" },
    raterId: { type: "string" },
    rateeId: { type: "string" },
    role: { type: "string", enum: RATING_ROLE_VALUES },
    score: { type: "integer" },
    comment: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
  },
};

// MOVO-170: subconjunto de estadísticas de uso calculable con datos ya persistidos,
// agregado por rol -- ver shipment-repository.ts#getUsageStatsByRole.
const usageStats = {
  type: "object",
  required: ["delivered", "cancelled", "avgPackageWeightKg"],
  properties: {
    delivered: { type: "integer" },
    cancelled: { type: "integer" },
    avgPackageWeightKg: { type: ["number", "null"] },
  },
};

// MOVO-147 AC3: "el mismo cálculo restringido al rol" -- asSender/asCarrier tienen la
// misma forma que el resultado global, cada uno con su propio ratingCount/isNewProfile.
// MOVO-170 sumó `usageStats`, exclusivo del desglose por rol (no del global).
const reputationBreakdown = {
  type: "object",
  required: ["reputationScore", "ratingCount", "isNewProfile", "usageStats"],
  properties: {
    reputationScore: { type: ["number", "null"] },
    ratingCount: { type: "integer" },
    isNewProfile: { type: "boolean" },
    usageStats,
  },
};

const reputationResponse = {
  type: "object",
  required: ["reputationScore", "ratingCount", "isNewProfile", "asSender", "asCarrier", "transactionCounts"],
  properties: {
    reputationScore: { type: ["number", "null"] },
    ratingCount: { type: "integer" },
    isNewProfile: { type: "boolean" },
    asSender: reputationBreakdown,
    asCarrier: reputationBreakdown,
    transactionCounts: {
      type: "object",
      required: ["asSender", "asCarrier"],
      properties: {
        asSender: { type: "integer" },
        asCarrier: { type: "integer" },
      },
    },
  },
};

export const ratingsSchemas = {
  shipmentIdParam: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
    },
  },

  shipmentRateeIdParam: {
    type: "object",
    required: ["id", "rateeId"],
    properties: {
      id: { type: "string", format: "uuid" },
      rateeId: { type: "string", format: "uuid" },
    },
  },

  userIdParam: {
    type: "object",
    required: ["userId"],
    properties: {
      userId: { type: "string", format: "uuid" },
    },
  },

  // MOVO-147: mismo recurso lógico que `userIdParam` de arriba, pero con `id` en vez de
  // `userId` -- el contrato del ticket fija el path como `/internal/users/:id/reputation`.
  reputationUserIdParam: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
    },
  },

  createRatingBody: {
    type: "object",
    required: ["rateeId", "score"],
    properties: {
      rateeId: { type: "string", format: "uuid" },
      score: { type: "integer", minimum: SCORE_MIN, maximum: SCORE_MAX },
      comment: { type: "string", maxLength: COMMENT_MAX_LENGTH },
    },
    additionalProperties: false,
  },

  updateRatingBody: {
    type: "object",
    required: ["score"],
    properties: {
      score: { type: "integer", minimum: SCORE_MIN, maximum: SCORE_MAX },
      comment: { type: "string", maxLength: COMMENT_MAX_LENGTH },
    },
    additionalProperties: false,
  },

  recentRatingsQuery: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: MAX_RECENT_RATINGS_LIMIT, default: DEFAULT_RECENT_RATINGS_LIMIT },
      // MOVO-170: cursor opaco (base64 de `createdAt|id`) para "ver todas las calificaciones".
      cursor: { type: "string" },
    },
  },

  ratingResponse,

  listRatingsResponse: {
    type: "array",
    items: ratingResponse,
  },

  // MOVO-170
  recentRatingsPageResponse: {
    type: "object",
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: ratingResponse },
      nextCursor: { type: ["string", "null"] },
    },
  },

  reputationResponse,

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
