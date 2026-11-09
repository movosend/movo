import {
  ADMIN_KYC_DECISION_REASON_MAX_LENGTH,
  ADMIN_KYC_NAME_MAX_LENGTH,
  ADMIN_KYC_REVIEW_DEFAULT_PAGE_SIZE,
  ADMIN_KYC_REVIEW_MAX_PAGE_SIZE,
} from "@movo/shared";

// Autocontenido a propósito, mismo criterio que `sanctions.schema.ts`: el serializador de Fastify descarta lo que no
// esté declarado acá, así que cada respuesta lista todos sus campos.
const str = { type: "string" } as const;
const nullableStr = { type: ["string", "null"] } as const;
const int = { type: "integer" } as const;

const object = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) =>
  ({ type: "object", required, properties }) as const;

// Con `details` libre: el 409 de una sesión que Didit ya tenía resuelta trae `status` ahí.
const errorResponse = object(
  {
    error: object(
      { code: str, message: str, statusCode: int, details: { type: "object", additionalProperties: true } },
      ["code", "message", "statusCode"],
    ),
    requestId: str,
  },
  ["error"],
);
const errors = {
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
  502: errorResponse,
};

const verificationType = { type: "string", enum: ["identity", "license"] } as const;

const rowProperties = {
  sessionId: str,
  userId: str,
  fullName: str,
  photoUrl: nullableStr,
  verificationType,
  reason: nullableStr,
  requestedAt: str,
  inReviewSince: nullableStr,
};

const sessionParams = object({ sessionId: { type: "string", minLength: 1, maxLength: 128 } });

const nNum = { type: ["number", "null"] } as const;
const nBool = { type: ["boolean", "null"] } as const;
const nullableObject = (properties: Record<string, unknown>) =>
  ({ type: ["object", "null"], required: Object.keys(properties), properties }) as const;
const contact = { status: nullableStr, value: nullableStr, country: nullableStr, isDisposable: nBool, isVirtual: nBool };

const evidence = object({
  fetchedAt: str,
  imagesExpireAt: str,
  sessionStatus: nullableStr,
  images: object({ selfie: nullableStr, documentPortrait: nullableStr, documentFront: nullableStr, documentBack: nullableStr, livenessVideo: nullableStr }),
  document: nullableObject({
    status: nullableStr,
    type: nullableStr,
    number: nullableStr,
    personalNumber: nullableStr,
    firstName: nullableStr,
    lastName: nullableStr,
    fullName: nullableStr,
    dateOfBirth: nullableStr,
    age: nNum,
    gender: nullableStr,
    nationality: nullableStr,
    issuingCountry: nullableStr,
    issueDate: nullableStr,
    expirationDate: nullableStr,
    address: nullableStr,
    placeOfBirth: nullableStr,
    maritalStatus: nullableStr,
  }),
  faceMatch: nullableObject({ status: nullableStr, score: nNum }),
  liveness: nullableObject({ status: nullableStr, method: nullableStr, score: nNum }),
  ip: nullableObject({
    status: nullableStr,
    address: nullableStr,
    country: nullableStr,
    region: nullableStr,
    city: nullableStr,
    isVpnOrTor: nBool,
    isDataCenter: nBool,
    platform: nullableStr,
    browser: nullableStr,
    os: nullableStr,
    device: nullableStr,
  }),
  aml: nullableObject({ status: nullableStr, totalHits: nNum, score: nNum }),
  phone: nullableObject(contact),
  email: nullableObject(contact),
  warnings: { type: "array", items: object({ feature: str, risk: str, description: str }) },
  reviews: { type: "array", items: object({ status: nullableStr, comment: nullableStr, createdAt: nullableStr }) },
});

export const kycSchemas = {
  list: {
    querystring: {
      type: "object",
      properties: {
        type: verificationType,
        q: { type: "string", maxLength: 100, default: "" },
        page: { type: "integer", minimum: 1, default: 1 },
        pageSize: {
          type: "integer",
          minimum: 1,
          maximum: ADMIN_KYC_REVIEW_MAX_PAGE_SIZE,
          default: ADMIN_KYC_REVIEW_DEFAULT_PAGE_SIZE,
        },
      },
    },
    response: {
      200: object({ items: { type: "array", items: object(rowProperties) }, page: int, pageSize: int, total: int }),
      ...errors,
    },
  },

  detail: {
    params: sessionParams,
    response: {
      200: object({
        ...rowProperties,
        status: str,
        resolvedAt: nullableStr,
        email: str,
        phone: str,
        firstName: str,
        lastName: str,
        expirationDate: nullableStr,
        decidable: { type: "boolean" },
        history: {
          type: "array",
          items: object({ sessionId: str, status: str, requestedAt: str, resolvedAt: nullableStr, reason: nullableStr }),
        },
      }),
      ...errors,
    },
  },

  evidence: {
    params: sessionParams,
    response: { 200: evidence, ...errors, 422: errorResponse },
  },

  decide: {
    params: sessionParams,
    body: {
      type: "object",
      required: ["decision", "reason"],
      additionalProperties: false,
      properties: {
        decision: { type: "string", enum: ["approved", "rejected"] },
        reason: { type: "string", minLength: 1, maxLength: ADMIN_KYC_DECISION_REASON_MAX_LENGTH },
        // Nombre y apellido corregidos al aprobar una identidad: los dos o ninguno (se valida en la ruta).
        firstName: { type: "string", minLength: 1, maxLength: ADMIN_KYC_NAME_MAX_LENGTH, pattern: "^\\S+(\\s+\\S+)*$" },
        lastName: { type: "string", minLength: 1, maxLength: ADMIN_KYC_NAME_MAX_LENGTH, pattern: "^\\S+(\\s+\\S+)*$" },
      },
    },
    response: {
      200: object({ sessionId: str, userId: str, verificationType, status: { type: "string", enum: ["approved", "rejected"] } }),
      ...errors,
    },
  },
} as const;
