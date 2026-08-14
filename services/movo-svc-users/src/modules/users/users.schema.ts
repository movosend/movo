// Autocontenido a propósito (no importa de otros *.schema.ts) — mismo criterio que ya
// usa el resto de los módulos: cada schema no comparte definiciones entre sí.
const KYC_STATUS_VALUES = ["not_started", "pending", "approved", "rejected", "expired", "manual_review"];
const ACCOUNT_STATUS_VALUES = ["active", "banned", "deleted"];
const USER_ROLE_VALUES = ["sender", "carrier", "admin"];
// MOVO-15 sumará "license_verified" cuando exista verificación de licencia.
const PROFILE_BADGE_VALUES = ["kyc_verified", "license_verified"];
// MOVO-97 AC2: mismos valores que ALLOWED_PHOTO_CONTENT_TYPES/MAX_PHOTO_CONTENT_LENGTH_BYTES
// de users.service.ts — duplicados acá por el mismo criterio de "autocontenido" de arriba.
const PHOTO_CONTENT_TYPE_VALUES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_CONTENT_LENGTH_BYTES = 5 * 1024 * 1024;

const transactionCounts = {
  type: "object",
  required: ["asSender", "asCarrier"],
  properties: {
    asSender: { type: "integer" },
    asCarrier: { type: "integer" },
  },
};

export const usersSchemas = {
  usersCountResponse: {
    type: "object",
    properties: {
      count: { type: "integer" },
    },
    required: ["count"],
  },

  userIdParam: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
    },
  },

  privateProfileResponse: {
    type: "object",
    required: [
      "id",
      "firstName",
      "lastName",
      "fullName",
      "email",
      "phone",
      "photoUrl",
      "kycStatus",
      "accountStatus",
      "roles",
      "badges",
      "transactionCounts",
      "reputationScore",
    ],
    properties: {
      id: { type: "string" },
      firstName: { type: "string" },
      lastName: { type: "string" },
      fullName: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      photoUrl: { type: ["string", "null"] },
      kycStatus: { type: "string", enum: KYC_STATUS_VALUES },
      accountStatus: { type: "string", enum: ACCOUNT_STATUS_VALUES },
      roles: { type: "array", items: { type: "string", enum: USER_ROLE_VALUES } },
      badges: { type: "array", items: { type: "string", enum: PROFILE_BADGE_VALUES } },
      transactionCounts,
      reputationScore: { type: ["number", "null"] },
    },
  },

  publicProfileResponse: {
    type: "object",
    required: ["id", "fullName", "photoUrl", "isVerified", "badges", "transactionCounts", "reputationScore"],
    properties: {
      id: { type: "string" },
      fullName: { type: "string" },
      photoUrl: { type: ["string", "null"] },
      isVerified: { type: "boolean" },
      badges: { type: "array", items: { type: "string", enum: PROFILE_BADGE_VALUES } },
      transactionCounts,
      reputationScore: { type: ["number", "null"] },
    },
  },

  photoUploadUrlBody: {
    type: "object",
    required: ["contentType", "contentLength"],
    properties: {
      contentType: { type: "string", enum: PHOTO_CONTENT_TYPE_VALUES },
      contentLength: { type: "integer", minimum: 1, maximum: MAX_PHOTO_CONTENT_LENGTH_BYTES },
    },
  },

  photoUploadUrlResponse: {
    type: "object",
    required: ["uploadUrl", "objectKey", "expiresIn"],
    properties: {
      uploadUrl: { type: "string" },
      objectKey: { type: "string" },
      expiresIn: { type: "integer" },
    },
  },

  confirmPhotoBody: {
    type: "object",
    required: ["objectKey"],
    properties: {
      objectKey: { type: "string" },
    },
  },

  confirmPhotoResponse: {
    type: "object",
    required: ["photoUrl"],
    properties: {
      photoUrl: { type: "string" },
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
