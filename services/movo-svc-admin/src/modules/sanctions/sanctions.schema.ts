import { ACCOUNT_SANCTION_NOTE_MAX_LENGTH, ACCOUNT_SANCTION_REASON_MAX_LENGTH } from "@movo/shared";

// Autocontenido a propósito, mismo criterio que `users.schema.ts`: el serializador de Fastify
// descarta lo que no esté declarado acá, así que cada respuesta lista todos sus campos.
const str = { type: "string" } as const;
const nullableStr = { type: ["string", "null"] } as const;
const int = { type: "integer" } as const;
const uuid = { type: "string", format: "uuid" } as const;
const uuidArray = { type: "array", items: str } as const;

const object = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) =>
  ({ type: "object", required, properties }) as const;

// Con `details` libre: el 409 `USER_HAS_IN_PROGRESS_SHIPMENTS` trae los envíos en curso ahí.
const errorResponse = object(
  {
    error: object({ code: str, message: str, statusCode: int, details: { type: "object", additionalProperties: true } }, [
      "code",
      "message",
      "statusCode",
    ]),
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

const inProgressShipment = object({
  id: str,
  shortId: str,
  status: str,
  userRole: str,
  pickupAddress: str,
  deliveryAddress: str,
});

const withdrawResult = object({
  cancelledShipmentIds: uuidArray,
  withdrawnOfferIds: uuidArray,
  cancelledTripIds: uuidArray,
  stoppedRecurrenceTripIds: uuidArray,
  notifiedCounterpartyCount: int,
  failures: { type: "array", items: object({ kind: str, id: str }) },
});

const withdrawal = object({
  status: { type: "string", enum: ["complete", "partial", "failed"] },
  result: { anyOf: [withdrawResult, { type: "null" }] },
  errorCode: nullableStr,
  attemptedAt: str,
});

const sanction = object({
  id: str,
  userId: str,
  type: { type: "string", enum: ["suspension", "disable"] },
  reason: str,
  internalNote: nullableStr,
  startedAt: str,
  endsAt: nullableStr,
  appliedBy: nullableStr,
  appliedByName: nullableStr,
  liftedAt: nullableStr,
  liftedBy: nullableStr,
  liftedByName: nullableStr,
  liftReason: nullableStr,
  closedCause: { type: ["string", "null"], enum: ["lifted", "replaced", "escalated", "expired", null] },
  withdrawal: { anyOf: [withdrawal, { type: "null" }] },
});

const idParam = object({ id: uuid });
const sanctionParams = object({ id: uuid, sanctionId: uuid });
const reason = { type: "string", minLength: 1, maxLength: ACCOUNT_SANCTION_REASON_MAX_LENGTH } as const;

export const sanctionsSchemas = {
  list: {
    params: idParam,
    response: { 200: object({ items: { type: "array", items: sanction } }), ...errors },
  },

  preview: {
    params: idParam,
    response: {
      200: object({
        shipments: int,
        offers: int,
        trips: int,
        recurringSeries: int,
        inProgressShipments: { type: "array", items: inProgressShipment },
      }),
      ...errors,
    },
  },

  apply: {
    params: idParam,
    body: {
      type: "object",
      required: ["type", "reason"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["suspension", "disable"] },
        reason,
        internalNote: { type: "string", maxLength: ACCOUNT_SANCTION_NOTE_MAX_LENGTH },
        endsAt: { type: "string", format: "date-time" },
      },
    },
    response: { 201: sanction, ...errors },
  },

  lift: {
    params: sanctionParams,
    body: { type: "object", required: ["reason"], additionalProperties: false, properties: { reason } },
    response: { 200: sanction, ...errors },
  },

  retryWithdrawal: {
    params: sanctionParams,
    response: { 200: withdrawal, ...errors },
  },
};
