import { ADMIN_USERS_MAX_PAGE_SIZE } from "./admin-users.service";

// Autocontenido a propósito -- mismo criterio que el resto de los *.schema.ts del repo. Internos:
// `hide: true`, el Swagger que importa es el de `svc-admin`, que es lo que ve el panel.
const nullableString = { type: ["string", "null"] } as const;
const kycStatus = { type: "string", enum: ["not_started", "pending", "approved", "rejected", "expired", "manual_review"] } as const;
const accountStatus = { type: "string", enum: ["active", "banned", "deleted"] } as const;
const userRef = {
  type: "object",
  required: ["id", "fullName"],
  properties: { id: { type: "string" }, fullName: { type: "string" } },
} as const;

const errorResponse = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "statusCode"],
      properties: { code: { type: "string" }, message: { type: "string" }, statusCode: { type: "integer" } },
    },
    requestId: { type: "string" },
  },
} as const;

const errors = { 400: errorResponse, 404: errorResponse, 409: errorResponse };

const idParam = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

const listItem = {
  type: "object",
  required: ["id", "fullName", "email", "phone", "dni", "photoUrl", "roles", "accountStatus", "bannedUntil", "kycIdentity", "kycLicense", "createdAt", "matchedBy"],
  properties: {
    id: { type: "string" },
    fullName: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    dni: nullableString,
    photoUrl: nullableString,
    roles: { type: "array", items: { type: "string" } },
    accountStatus,
    bannedUntil: nullableString,
    kycIdentity: kycStatus,
    kycLicense: kycStatus,
    createdAt: { type: "string" },
    matchedBy: { type: ["string", "null"], enum: ["name", "email", "dni", "phone", null] },
  },
} as const;

const kycCard = {
  type: "object",
  required: ["status", "lastSessionId", "attempts"],
  properties: {
    status: kycStatus,
    lastSessionId: nullableString,
    expiresAt: nullableString,
    attempts: {
      type: "array",
      items: {
        type: "object",
        required: ["status", "requestedAt", "resolvedAt", "reason"],
        properties: { status: kycStatus, requestedAt: { type: "string" }, resolvedAt: nullableString, reason: nullableString },
      },
    },
  },
} as const;

const report = {
  type: "object",
  required: ["id", "reason", "status", "counterpart", "details", "createdAt", "extraEntries", "photos"],
  properties: {
    id: { type: "string" },
    reason: { type: "string" },
    status: { type: "string" },
    counterpart: userRef,
    details: nullableString,
    createdAt: { type: "string" },
    extraEntries: { type: "integer" },
    photos: { type: "integer" },
  },
} as const;

const block = {
  type: "object",
  required: ["user", "createdAt"],
  properties: { user: userRef, createdAt: { type: "string" } },
} as const;

export const adminUsersSchemas = {
  search: {
    hide: true,
    querystring: {
      type: "object",
      properties: {
        q: { type: "string", maxLength: 100, default: "" },
        page: { type: "integer", minimum: 1, default: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: ADMIN_USERS_MAX_PAGE_SIZE, default: 10 },
      },
    },
    response: {
      200: {
        type: "object",
        required: ["items", "page", "pageSize", "total"],
        properties: { items: { type: "array", items: listItem }, page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" } },
      },
      400: errorResponse,
    },
  },

  profile: {
    hide: true,
    params: idParam,
    response: {
      200: {
        type: "object",
        required: ["id", "firstName", "lastName", "fullName", "email", "emailVerified", "phone", "phoneVerified", "dni", "birthdate", "photoUrl", "createdAt", "deletedAt", "roles", "accountStatus", "bannedUntil"],
        properties: {
          id: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          fullName: { type: "string" },
          email: { type: "string" },
          emailVerified: { type: "boolean" },
          phone: { type: "string" },
          phoneVerified: { type: "boolean" },
          dni: nullableString,
          birthdate: nullableString,
          photoUrl: nullableString,
          createdAt: { type: "string" },
          deletedAt: nullableString,
          roles: {
            type: "array",
            items: { type: "object", required: ["role", "grantedAt"], properties: { role: { type: "string" }, grantedAt: { type: "string" } } },
          },
          accountStatus,
          bannedUntil: nullableString,
        },
      },
      ...errors,
    },
  },

  kyc: {
    hide: true,
    params: idParam,
    response: {
      200: { type: "object", required: ["identity", "license"], properties: { identity: kycCard, license: kycCard } },
      ...errors,
    },
  },

  vehicle: {
    hide: true,
    params: idParam,
    response: {
      200: {
        type: "object",
        required: ["vehicle"],
        properties: {
          vehicle: {
            type: ["object", "null"],
            required: ["brand", "model", "licensePlate", "cargoCapacityLabel"],
            properties: { brand: { type: "string" }, model: { type: "string" }, licensePlate: { type: "string" }, cargoCapacityLabel: { type: "string" } },
          },
        },
      },
      ...errors,
    },
  },

  moderation: {
    hide: true,
    params: idParam,
    response: {
      200: {
        type: "object",
        required: ["reports", "blocks", "totals"],
        properties: {
          reports: {
            type: "object",
            required: ["received", "made"],
            properties: { received: { type: "array", items: report }, made: { type: "array", items: report } },
          },
          blocks: {
            type: "object",
            required: ["made", "received"],
            properties: { made: { type: "array", items: block }, received: { type: "array", items: block } },
          },
          totals: {
            type: "object",
            required: ["reportsReceived", "reportsMade", "blocksMade", "blocksReceived"],
            properties: {
              reportsReceived: { type: "integer" },
              reportsMade: { type: "integer" },
              blocksMade: { type: "integer" },
              blocksReceived: { type: "integer" },
            },
          },
        },
      },
      ...errors,
    },
  },

  devices: {
    hide: true,
    params: idParam,
    response: {
      200: {
        type: "object",
        required: ["devices", "handshakeKey"],
        properties: {
          devices: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "platform", "deviceId", "updatedAt"],
              properties: { id: { type: "string" }, platform: { type: "string", enum: ["ios", "android"] }, deviceId: { type: "string" }, updatedAt: { type: "string" } },
            },
          },
          handshakeKey: { type: ["object", "null"], required: ["registeredAt"], properties: { registeredAt: { type: "string" } } },
        },
      },
      ...errors,
    },
  },

  names: {
    hide: true,
    body: {
      type: "object",
      required: ["ids"],
      additionalProperties: false,
      properties: { ids: { type: "array", maxItems: 200, uniqueItems: true, items: { type: "string", format: "uuid" } } },
    },
    response: {
      200: { type: "object", required: ["users"], properties: { users: { type: "array", items: userRef } } },
      400: errorResponse,
    },
  },

  revokeSessions: {
    hide: true,
    params: idParam,
    response: {
      200: { type: "object", required: ["revokedRefreshTokens"], properties: { revokedRefreshTokens: { type: "integer" } } },
      ...errors,
    },
  },

  updateContact: {
    hide: true,
    params: idParam,
    body: {
      type: "object",
      required: ["field", "newValue", "expectedCurrent"],
      additionalProperties: false,
      properties: {
        field: { type: "string", enum: ["email", "phone"] },
        newValue: { type: "string", minLength: 1, maxLength: 254 },
        expectedCurrent: { type: "string", minLength: 1, maxLength: 254 },
      },
    },
    response: {
      200: {
        type: "object",
        required: ["email", "emailVerified", "phone", "phoneVerified", "revokedRefreshTokens", "noticeFailed"],
        properties: {
          email: { type: "string" },
          emailVerified: { type: "boolean" },
          phone: { type: "string" },
          phoneVerified: { type: "boolean" },
          revokedRefreshTokens: { type: "integer" },
          noticeFailed: { type: "boolean" },
        },
      },
      ...errors,
    },
  },
};
