import { ADMIN_ACTION_REASON_MAX_LENGTH, ADMIN_NOTE_MAX_LENGTH } from "@movo/shared";

// Autocontenido a propósito -- mismo criterio que el resto de los *.schema.ts del repo. Es el
// Swagger que consume el panel (`@movo/shared`, `types/admin-users.ts`): el serializador de
// Fastify descarta lo que no esté declarado acá, así que cada respuesta lista todos sus campos.
const str = { type: "string" } as const;
const nullableStr = { type: ["string", "null"] } as const;
const int = { type: "integer" } as const;
const uuid = { type: "string", format: "uuid" } as const;

const KYC_STATUSES = ["not_started", "pending", "approved", "rejected", "expired", "manual_review"] as const;
const ACCOUNT_STATUSES = ["active", "banned", "deleted"] as const;
const SHIPMENT_ROLES = ["sender", "carrier", "receiver"] as const;
export const SHIPMENT_STATUSES = [
  "awaiting_receiver_confirmation",
  "rejected_by_receiver",
  "published",
  "assignment_pending",
  "assigned_unfunded",
  "assigned",
  "in_transit",
  "delivered",
  "completed",
  "cancelled",
  "disputed",
] as const;
export const TRIP_STATUSES = ["declared", "active", "cancelled", "expired", "completed"] as const;
const LEDGER_TYPES = [
  "cancellation_penalty",
  "penalty_capture",
  "cash_commission",
  "fee_offset",
  "payment_surcharge",
  "voluntary_payment",
  "manual_adjustment",
] as const;
const LEDGER_STATUSES = ["pending", "reserved", "settled", "voided"] as const;

const kycStatus = { type: "string", enum: KYC_STATUSES } as const;
const accountStatus = { type: "string", enum: ACCOUNT_STATUSES } as const;

const object = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) =>
  ({ type: "object", required, properties }) as const;

const userRef = object({ id: str, fullName: str });

const errorResponse = object(
  {
    error: object({ code: str, message: str, statusCode: int }),
    requestId: str,
  },
  ["error"],
);

/** Errores comunes de toda la ficha: identidad/rol (401/403), validación, usuario y servicio dueño. */
export const errors = {
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
  422: errorResponse,
  502: errorResponse,
};

const idParam = object({ id: uuid });
const pageQuery = (defaultPageSize: number) => ({
  page: { type: "integer", minimum: 1, default: 1 },
  pageSize: { type: "integer", minimum: 1, maximum: 50, default: defaultPageSize },
});
const cursorQuery = {
  limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
  cursor: { type: "string", minLength: 1, maxLength: 200 },
};
const reason = { type: "string", minLength: 1, maxLength: ADMIN_ACTION_REASON_MAX_LENGTH } as const;

const listItem = object({
  id: str,
  fullName: str,
  email: str,
  phone: str,
  dni: nullableStr,
  photoUrl: nullableStr,
  roles: { type: "array", items: str },
  accountStatus,
  bannedUntil: nullableStr,
  kycIdentity: kycStatus,
  kycLicense: kycStatus,
  createdAt: str,
  matchedBy: { type: ["string", "null"], enum: ["name", "email", "dni", "phone", null] },
});

const kycCard = object(
  {
    status: kycStatus,
    lastSessionId: nullableStr,
    expiresAt: nullableStr,
    attempts: {
      type: "array",
      items: object({ status: kycStatus, requestedAt: str, resolvedAt: nullableStr, reason: nullableStr }),
    },
  },
  ["status", "lastSessionId", "attempts"],
);

const report = object({
  id: str,
  reason: str,
  status: str,
  counterpart: userRef,
  details: nullableStr,
  createdAt: str,
  extraEntries: int,
  photos: int,
});
const block = object({ user: userRef, createdAt: str });

const ledgerEntry = object({
  id: str,
  type: { type: "string", enum: LEDGER_TYPES },
  amountArs: { type: "number" },
  status: { type: "string", enum: LEDGER_STATUSES },
  shipmentId: nullableStr,
  reason: nullableStr,
  adminName: nullableStr,
  createdAt: str,
});

const note = object({ id: str, body: str, adminId: str, adminName: str, createdAt: str });

export const usersSchemas = {
  search: {
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: { q: { type: "string", maxLength: 100, default: "" }, ...pageQuery(10) },
    },
    response: {
      200: object({ items: { type: "array", items: listItem }, page: int, pageSize: int, total: int }),
      ...errors,
    },
  },

  profile: {
    params: idParam,
    response: {
      200: object({
        id: str,
        firstName: str,
        lastName: str,
        fullName: str,
        email: str,
        emailVerified: { type: "boolean" },
        phone: str,
        phoneVerified: { type: "boolean" },
        dni: nullableStr,
        birthdate: nullableStr,
        photoUrl: nullableStr,
        createdAt: str,
        deletedAt: nullableStr,
        roles: { type: "array", items: object({ role: str, grantedAt: str }) },
        accountStatus,
        bannedUntil: nullableStr,
      }),
      ...errors,
    },
  },

  kyc: {
    params: idParam,
    response: {
      200: object({
        identity: kycCard,
        license: kycCard,
        mercadoPago: object({
          status: { type: "string", enum: ["linked", "not_linked", "revoked"] },
          nickname: nullableStr,
          connectedAt: nullableStr,
          unlinkedAt: nullableStr,
        }),
      }),
      ...errors,
    },
  },

  vehicle: {
    params: idParam,
    response: {
      200: object({
        vehicle: { ...object({ brand: str, model: str, licensePlate: str, cargoCapacityLabel: str }), type: ["object", "null"] },
      }),
      ...errors,
    },
  },

  shipments: {
    params: idParam,
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: {
        role: { type: "string", enum: SHIPMENT_ROLES },
        status: { type: "string", enum: SHIPMENT_STATUSES },
        ...pageQuery(5),
      },
    },
    response: {
      200: object({
        items: {
          type: "array",
          items: object({
            id: str,
            shortId: str,
            status: { type: "string", enum: SHIPMENT_STATUSES },
            pickupAddress: str,
            deliveryAddress: str,
            priceArs: { type: ["number", "null"] },
            createdAt: str,
            userRole: { type: "string", enum: SHIPMENT_ROLES },
            sender: userRef,
            carrier: { ...userRef, type: ["object", "null"] },
            receiver: userRef,
          }),
        },
        page: int,
        pageSize: int,
        total: int,
        counts: object({ sender: int, carrier: int, receiver: int }),
      }),
      ...errors,
    },
  },

  trips: {
    params: idParam,
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: { status: { type: "string", enum: TRIP_STATUSES }, ...pageQuery(5) },
    },
    response: {
      200: object({
        items: {
          type: "array",
          items: object({
            id: str,
            originAddress: str,
            destinationAddress: str,
            departureAt: str,
            vehicleType: str,
            status: { type: "string", enum: TRIP_STATUSES },
            recurring: { type: "boolean" },
          }),
        },
        page: int,
        pageSize: int,
        total: int,
      }),
      ...errors,
    },
  },

  ratings: {
    params: idParam,
    querystring: { type: "object", additionalProperties: false, properties: pageQuery(5) },
    response: {
      200: object({
        average: { type: ["number", "null"] },
        count: int,
        items: {
          type: "array",
          items: object({
            score: int,
            comment: nullableStr,
            rater: userRef,
            roleOfRated: { type: "string", enum: SHIPMENT_ROLES },
            shipmentId: str,
            createdAt: str,
          }),
        },
        page: int,
        pageSize: int,
      }),
      ...errors,
    },
  },

  moderation: {
    params: idParam,
    response: {
      200: object({
        reports: object({ received: { type: "array", items: report }, made: { type: "array", items: report } }),
        blocks: object({ made: { type: "array", items: block }, received: { type: "array", items: block } }),
        totals: object({ reportsReceived: int, reportsMade: int, blocksMade: int, blocksReceived: int }),
      }),
      ...errors,
    },
  },

  suspensions: {
    params: idParam,
    response: {
      200: object({
        items: {
          type: "array",
          items: object(
            {
              type: { type: "string", enum: ["temporary", "permanent"] },
              days: int,
              reason: str,
              adminId: str,
              adminName: str,
              createdAt: str,
              status: { type: "string", enum: ["active", "lifted"] },
              liftedAt: str,
              liftedBy: str,
            },
            ["type", "reason", "adminId", "adminName", "createdAt", "status"],
          ),
        },
      }),
      ...errors,
    },
  },

  ledger: {
    params: idParam,
    querystring: { type: "object", additionalProperties: false, properties: cursorQuery },
    response: {
      200: object({ balanceArs: { type: "number" }, items: { type: "array", items: ledgerEntry }, nextCursor: nullableStr }),
      ...errors,
    },
  },

  devices: {
    params: idParam,
    response: {
      200: object({
        devices: {
          type: "array",
          items: object({ id: str, platform: { type: "string", enum: ["ios", "android"] }, deviceId: str, updatedAt: str }),
        },
        handshakeKey: { ...object({ registeredAt: str }), type: ["object", "null"] },
      }),
      ...errors,
    },
  },

  auditLog: {
    params: idParam,
    querystring: { type: "object", additionalProperties: false, properties: cursorQuery },
    response: {
      200: object({
        items: {
          type: "array",
          items: object({
            id: str,
            adminId: str,
            adminName: str,
            action: str,
            reason: nullableStr,
            outcome: { type: "string", enum: ["succeeded", "failed", "unknown"] },
            errorCode: nullableStr,
            createdAt: str,
          }),
        },
        nextCursor: nullableStr,
      }),
      ...errors,
    },
  },

  notes: {
    params: idParam,
    querystring: { type: "object", additionalProperties: false, properties: cursorQuery },
    response: {
      200: object({ items: { type: "array", items: note }, nextCursor: nullableStr }),
      ...errors,
    },
  },

  addNote: {
    params: idParam,
    body: {
      type: "object",
      required: ["body"],
      additionalProperties: false,
      properties: { body: { type: "string", minLength: 1, maxLength: ADMIN_NOTE_MAX_LENGTH } },
    },
    response: { 201: note, ...errors },
  },

  revokeSessions: {
    params: idParam,
    body: { type: "object", required: ["reason"], additionalProperties: false, properties: { reason } },
    response: { 200: object({ revokedRefreshTokens: int }), ...errors },
  },

  updateContact: {
    params: idParam,
    body: {
      type: "object",
      required: ["field", "newValue", "expectedCurrent", "reason"],
      additionalProperties: false,
      properties: {
        field: { type: "string", enum: ["email", "phone"] },
        newValue: { type: "string", minLength: 1, maxLength: 254 },
        expectedCurrent: { type: "string", minLength: 1, maxLength: 254 },
        reason,
      },
    },
    response: {
      200: object({
        email: str,
        emailVerified: { type: "boolean" },
        phone: str,
        phoneVerified: { type: "boolean" },
        revokedRefreshTokens: int,
      }),
      ...errors,
    },
  },

  adjustLedger: {
    params: idParam,
    body: {
      type: "object",
      required: ["amountArs", "reason", "idempotencyKey"],
      additionalProperties: false,
      properties: { amountArs: { type: "number" }, reason, idempotencyKey: uuid },
    },
    response: { 200: object({ entry: ledgerEntry, balanceArs: { type: "number" } }), ...errors },
  },
};
