import {
  DISPUTE_TEXT_MAX_LENGTH,
  DisputeReason,
  DisputeStatus,
  MAX_REPORT_PHOTOS_PER_SUBMISSION,
  USER_SELECTABLE_DISPUTE_REASONS,
} from "@movo/shared";

// MOVO-334: mismo tipo y tope que las fotos del envío (`shipments.schema.ts`, MOVO-81).
const PHOTO_CONTENT_TYPE_VALUES = ["image/jpeg"];
const MAX_PHOTO_CONTENT_LENGTH_BYTES = 2 * 1024 * 1024;

const PARTY_ROLES = ["sender", "receiver", "carrier"];

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
        details: { type: "object", additionalProperties: true },
      },
    },
    requestId: { type: "string" },
  },
};

const photoKeys = {
  type: "array",
  items: { type: "string", minLength: 1 },
  maxItems: MAX_REPORT_PHOTOS_PER_SUBMISSION,
};

const disputeText = {
  type: "string",
  minLength: 1,
  maxLength: DISPUTE_TEXT_MAX_LENGTH,
};

const photo = {
  type: "object",
  required: ["id", "url", "expiresIn"],
  properties: {
    id: { type: "string" },
    url: { type: "string" },
    expiresIn: { type: "integer" },
  },
};

// Wire contract de `DisputeDetail` (@movo/shared). Sin notas internas del admin.
const disputeResponse = {
  type: "object",
  required: [
    "id",
    "shipmentId",
    "openedBy",
    "openedByRole",
    "reason",
    "description",
    "status",
    "openedAt",
    "photos",
    "statements",
  ],
  properties: {
    id: { type: "string" },
    shipmentId: { type: "string" },
    openedBy: { type: ["string", "null"] },
    openedByRole: { type: ["string", "null"], enum: [...PARTY_ROLES, null] },
    reason: { type: "string", enum: Object.values(DisputeReason) },
    description: { type: "string" },
    status: { type: "string", enum: Object.values(DisputeStatus) },
    openedAt: { type: "string", format: "date-time" },
    photos: { type: "array", items: photo },
    statements: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "authorId",
          "authorRole",
          "kind",
          "text",
          "photos",
          "createdAt",
        ],
        properties: {
          id: { type: "string" },
          authorId: { type: "string" },
          authorRole: { type: "string", enum: PARTY_ROLES },
          kind: { type: "string", enum: ["statement", "amendment"] },
          text: { type: "string" },
          photos: { type: "array", items: photo },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
};

export const disputesSchemas = {
  shipmentIdParam: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
  disputeIdParam: {
    type: "object",
    required: ["disputeId"],
    properties: { disputeId: { type: "string", format: "uuid" } },
  },
  presignPhotoBody: {
    type: "object",
    required: ["contentType", "contentLength"],
    properties: {
      contentType: { type: "string", enum: PHOTO_CONTENT_TYPE_VALUES },
      contentLength: {
        type: "integer",
        minimum: 1,
        maximum: MAX_PHOTO_CONTENT_LENGTH_BYTES,
      },
    },
    additionalProperties: false,
  },
  presignPhotoResponse: {
    type: "object",
    required: ["uploadUrl", "s3Key", "expiresIn"],
    properties: {
      uploadUrl: { type: "string" },
      s3Key: { type: "string" },
      expiresIn: { type: "integer" },
    },
  },
  openDisputeBody: {
    type: "object",
    required: ["reason", "description"],
    properties: {
      // Solo los motivos elegibles desde la app: `transit_anomaly`/`pickup_no_show` son del sistema.
      reason: { type: "string", enum: [...USER_SELECTABLE_DISPUTE_REASONS] },
      description: disputeText,
      photoKeys,
    },
    additionalProperties: false,
  },
  statementBody: {
    type: "object",
    required: ["text"],
    properties: {
      text: disputeText,
      photoKeys,
    },
    additionalProperties: false,
  },
  disputeResponse,
  errorResponse,
};
