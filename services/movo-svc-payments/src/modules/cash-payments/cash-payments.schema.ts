import { entry, errorResponse } from "../user-ledger/user-ledger.schema";

// MOVO-37: schemas de los endpoints internos de envíos en efectivo. Reflejan `types/user-ledger.ts` de @movo/shared;
// internos, con `hide: true`. Los decimales de los montos los valida el service (Ajv compara en float).

const uuid = { type: "string", format: "uuid" } as const;
const money = { type: "number", exclusiveMinimum: 0, maximum: 10000000 } as const;
const shipmentIdParams = { type: "object", required: ["shipmentId"], properties: { shipmentId: uuid } } as const;

const commissionResponse = {
  type: "object",
  required: ["commissionArs", "entry", "created"],
  properties: { commissionArs: { type: "number" }, entry, created: { type: "boolean" } },
} as const;

const penaltyResponse = {
  type: "object",
  required: ["penaltyEntry", "compensationEntry", "compensationArs", "created"],
  properties: {
    penaltyEntry: entry,
    compensationEntry: { anyOf: [entry, { type: "null" }] },
    compensationArs: { type: "number" },
    created: { type: "boolean" },
  },
} as const;

export const registerCashCommissionSchema = {
  hide: true,
  params: shipmentIdParams,
  body: {
    type: "object",
    required: ["senderId", "carrierId", "agreedPriceArs"],
    additionalProperties: false,
    properties: { senderId: uuid, carrierId: uuid, agreedPriceArs: money },
  },
  response: {
    200: commissionResponse,
    201: commissionResponse,
    400: errorResponse,
    409: errorResponse,
  },
} as const;

export const registerCashCancellationPenaltySchema = {
  hide: true,
  params: shipmentIdParams,
  body: {
    type: "object",
    required: ["senderId", "carrierId", "agreedPriceArs", "penaltyArs"],
    additionalProperties: false,
    properties: { senderId: uuid, carrierId: uuid, agreedPriceArs: money, penaltyArs: money },
  },
  response: {
    200: penaltyResponse,
    201: penaltyResponse,
    400: errorResponse,
    409: errorResponse,
  },
} as const;
