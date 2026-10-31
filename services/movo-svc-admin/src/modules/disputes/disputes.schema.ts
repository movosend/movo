import {
  ADMIN_DISPUTE_SORTS,
  DISPUTE_NOTE_MAX_LENGTH,
  DISPUTE_OUTCOMES,
  DISPUTE_PARTIAL_PRESETS,
  DISPUTE_PAYMENT_ACTIONS,
  DISPUTE_REASONING_MAX_LENGTH,
  DisputeReason,
  DisputeStatus,
} from "@movo/shared";
import { shipmentsSchemas } from "../shipments/shipments.schema";

const errorResponse = shipmentsSchemas.errorResponse;
const errors = {
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
  422: errorResponse,
  502: errorResponse,
};

const str = { type: "string" } as const;
const nullableStr = { type: ["string", "null"] } as const;
const num = { type: "number" } as const;
const outcomes = [...DISPUTE_OUTCOMES];
const statuses = Object.values(DisputeStatus);
const reasons = Object.values(DisputeReason);

const party = {
  type: "object",
  required: ["id", "name"],
  properties: { id: str, name: nullableStr },
};

const row = {
  type: "object",
  required: [
    "id",
    "shipmentId",
    "shipmentCode",
    "status",
    "reason",
    "openedAt",
    "shipmentStatusAtOpen",
    "shipmentStatus",
    "sender",
    "carrier",
    "receiver",
    "outcome",
  ],
  properties: {
    id: str,
    shipmentId: str,
    shipmentCode: str,
    status: { type: "string", enum: statuses },
    reason: { type: "string", enum: reasons },
    openedByRole: { type: ["string", "null"], enum: ["sender", "receiver", "carrier", null] },
    openedAt: str,
    shipmentStatusAtOpen: str,
    shipmentStatus: str,
    sender: party,
    carrier: { ...party, type: ["object", "null"] },
    receiver: party,
    outcome: { type: ["string", "null"], enum: [...outcomes, null] },
    // MOVO-341. Fuera de `required` a propósito: si `svc-shipments` todavía no lo manda (deploy en serie), no se cae la ruta.
    pickupCity: nullableStr,
  },
};

const partyHistory = {
  type: "array",
  items: {
    type: "object",
    required: ["userId", "role", "opened", "lost", "open"],
    properties: {
      userId: str,
      role: { type: "string", enum: ["sender", "carrier", "receiver"] },
      opened: { type: "integer" },
      lost: { type: "integer" },
      open: { type: "integer" },
    },
  },
};

const attribution = {
  type: ["object", "null"],
  properties: {
    reason: { type: "string", enum: ["transit_anomaly", "pickup_no_show"] },
    attributedTo: { type: ["string", "null"], enum: ["carrier", "sender", null] },
    summary: str,
    sweptAt: str,
    lastPingAt: nullableStr,
    positions: {
      type: "array",
      items: {
        type: "object",
        required: ["lat", "lng", "accuracyM", "capturedAt", "class"],
        properties: { lat: num, lng: num, accuracyM: num, capturedAt: str, class: { type: "string", enum: ["arrival", "far", "gray"] } },
      },
    },
    farPositionsInWindow: { type: "integer" },
    grayPositionsInWindow: { type: "integer" },
  },
};

const photo = {
  type: "object",
  required: ["id", "url", "expiresIn"],
  properties: { id: str, url: str, expiresIn: { type: "integer" } },
};

const resolution = {
  type: ["object", "null"],
  properties: {
    outcome: { type: "string", enum: outcomes },
    reasoning: str,
    percentage: { type: ["integer", "null"] },
    carrierAmountArs: num,
    senderAmountArs: num,
    paymentAction: { type: "string", enum: [...DISPUTE_PAYMENT_ACTIONS] },
    resolvedBy: str,
    resolvedAt: nullableStr,
  },
};

const detail = {
  type: "object",
  required: [...row.required, "description", "photos", "statements", "resolution"],
  properties: {
    ...row.properties,
    description: str,
    photos: { type: "array", items: photo },
    statements: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "authorId", "authorRole", "kind", "text", "photos", "createdAt"],
        properties: {
          id: str,
          authorId: str,
          authorRole: { type: "string", enum: ["sender", "receiver", "carrier"] },
          kind: { type: "string", enum: ["statement", "amendment"] },
          text: str,
          photos: { type: "array", items: photo },
          createdAt: str,
        },
      },
    },
    resolution,
    partyHistory,
    attribution,
  },
};

const note = {
  type: "object",
  required: ["id", "disputeId", "adminId", "adminName", "body", "createdAt"],
  properties: { id: str, disputeId: str, adminId: str, adminName: nullableStr, body: str, createdAt: str },
};

const idParam = shipmentsSchemas.idParam;

export const disputesSchemas = {
  list: {
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: statuses },
        reason: { type: "string", enum: reasons },
        outcome: { type: "string", enum: outcomes },
        q: { type: "string", minLength: 1, maxLength: 100, description: "Código del envío o nombre de cualquiera de las partes." },
        city: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          description: "Ciudad del retiro: coincidencia parcial, sin distinguir mayúsculas ni tildes.",
        },
        sort: { type: "string", enum: [...ADMIN_DISPUTE_SORTS], description: "Por fecha de apertura; por defecto `newest`." },
        from: { type: "string", format: "date-time" },
        to: { type: "string", format: "date-time" },
        cursor: { type: "string", maxLength: 64 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
    response: {
      200: {
        type: "object",
        required: ["items", "nextCursor", "statusCounts"],
        properties: {
          items: { type: "array", items: row },
          nextCursor: nullableStr,
          statusCounts: {
            type: "object",
            required: statuses,
            properties: Object.fromEntries(statuses.map((status) => [status, { type: "integer" }])),
          },
        },
      },
      ...errors,
    },
  },
  counts: {
    response: {
      200: {
        type: "object",
        required: ["open", "resolving", "openOlderThan3Days", "openOlderThan7Days"],
        properties: {
          open: { type: "integer" },
          resolving: { type: "integer" },
          openOlderThan3Days: { type: "integer" },
          openOlderThan7Days: { type: "integer" },
        },
      },
      ...errors,
    },
  },
  detail: { params: idParam, response: { 200: detail, ...errors } },
  photos: {
    params: idParam,
    response: {
      200: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "stage", "url", "createdAt"],
          properties: { id: str, stage: str, url: str, createdAt: str },
        },
      },
      ...errors,
    },
  },
  handshake: {
    params: idParam,
    response: {
      200: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "stage", "actorId", "counterpartyId", "distanceM", "createdAt"],
          properties: { id: str, stage: str, actorId: str, counterpartyId: str, distanceM: num, createdAt: str },
        },
      },
      ...errors,
    },
  },
  trace: {
    params: idParam,
    response: {
      200: {
        type: "object",
        required: ["available", "points"],
        properties: {
          available: { type: "boolean" },
          points: {
            type: "array",
            items: {
              type: "object",
              required: ["lat", "lng", "accuracyM", "capturedAt", "mocked"],
              properties: { lat: num, lng: num, accuracyM: num, capturedAt: str, mocked: { type: ["boolean", "null"] } },
            },
          },
        },
      },
      ...errors,
    },
  },
  chat: {
    params: idParam,
    querystring: shipmentsSchemas.chatQuery,
    response: { 200: shipmentsSchemas.chatResponse, ...errors },
  },
  preview: {
    params: idParam,
    response: {
      200: {
        type: "object",
        required: ["statusAtOpen", "stakeArs", "minimumPartialArs", "outcomes", "presets"],
        properties: {
          statusAtOpen: { type: "string", enum: ["assigned", "in_transit", "delivered", "completed"] },
          stakeArs: num,
          minimumPartialArs: { type: ["number", "null"] },
          outcomes: {
            type: "array",
            items: {
              type: "object",
              required: ["outcome", "paymentAction", "shipmentStatus"],
              properties: {
                outcome: { type: "string", enum: outcomes },
                paymentAction: { type: "string", enum: [...DISPUTE_PAYMENT_ACTIONS] },
                shipmentStatus: { type: "string", enum: ["completed", "cancelled"] },
              },
            },
          },
          presets: {
            type: "array",
            items: {
              type: "object",
              required: ["percentage", "carrierAmountArs", "senderAmountArs", "belowMinimum"],
              properties: {
                percentage: { type: "integer" },
                carrierAmountArs: num,
                senderAmountArs: num,
                belowMinimum: { type: "boolean" },
              },
            },
          },
        },
      },
      ...errors,
    },
  },
  notes: {
    params: idParam,
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: { cursor: { type: "string", maxLength: 300 }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
    },
    response: {
      200: {
        type: "object",
        required: ["items", "nextCursor"],
        properties: { items: { type: "array", items: note }, nextCursor: nullableStr },
      },
      ...errors,
    },
  },
  addNote: {
    params: idParam,
    body: {
      type: "object",
      required: ["body"],
      additionalProperties: false,
      properties: { body: { type: "string", minLength: 1, maxLength: DISPUTE_NOTE_MAX_LENGTH } },
    },
    response: { 201: note, ...errors },
  },
  resolve: {
    params: idParam,
    body: {
      type: "object",
      required: ["outcome", "reasoning"],
      additionalProperties: false,
      properties: {
        outcome: { type: "string", enum: outcomes },
        reasoning: { type: "string", minLength: 1, maxLength: DISPUTE_REASONING_MAX_LENGTH + 200 },
        percentage: { type: "integer", enum: [...DISPUTE_PARTIAL_PRESETS], description: "Solo `partial`. Excluyente con `amountArs`." },
        amountArs: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: 10_000_000,
          description: "Solo `partial`: lo que conserva el transportista.",
        },
      },
    },
    response: {
      200: {
        type: "object",
        required: [
          "disputeId",
          "shipmentId",
          "outcome",
          "reasoning",
          "carrierAmountArs",
          "senderAmountArs",
          "paymentAction",
          "status",
          "shipmentStatus",
          "replayed",
          "resolvedAt",
        ],
        properties: {
          disputeId: str,
          shipmentId: str,
          outcome: { type: "string", enum: outcomes },
          reasoning: str,
          carrierAmountArs: num,
          senderAmountArs: num,
          paymentAction: { type: "string", enum: [...DISPUTE_PAYMENT_ACTIONS] },
          status: { type: "string", enum: ["resolved"] },
          shipmentStatus: { type: "string", enum: ["completed", "cancelled"] },
          replayed: { type: "boolean" },
          resolvedAt: str,
        },
      },
      ...errors,
    },
  },
};
