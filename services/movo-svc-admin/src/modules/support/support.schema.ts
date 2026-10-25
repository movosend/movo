import { SUPPORT_MESSAGE_MAX_LENGTH, SUPPORT_PRIORITIES, SUPPORT_STATUSES, SUPPORT_TAGS, SUPPORT_TOPICS } from "@movo/shared";

// MOVO-322: wire contract de `/admin/support/*` (`Support*` de `@movo/shared/src/types/admin-support.ts`, que definió el
// panel en MOVO-323). Autocontenido a propósito, mismo criterio que el resto de los *.schema.ts del repo.

const uuid = { type: "string", format: "uuid" } as const;
const status = { type: "string", enum: [...SUPPORT_STATUSES] };
const priority = { type: "string", enum: [...SUPPORT_PRIORITIES] };
const topic = { type: "string", enum: [...SUPPORT_TOPICS] };
const tag = { type: "string", enum: [...SUPPORT_TAGS] };
const isoDate = { type: "string", format: "date-time" } as const;

const idParam = { type: "object", required: ["id"], properties: { id: uuid } };

const agentRef = { type: "object", required: ["id", "fullName"], properties: { id: { type: "string" }, fullName: { type: "string" } } };

const attachment = {
  type: "object",
  required: ["id", "contentType", "url"],
  properties: {
    id: { type: "string" },
    contentType: { type: "string" },
    width: { type: "integer" },
    height: { type: "integer" },
    url: { type: "string" },
  },
};

const rowProperties = {
  id: { type: "string" },
  code: { type: "string" },
  user: {
    type: "object",
    required: ["id", "fullName", "role"],
    properties: { id: { type: "string" }, fullName: { type: "string" }, role: { type: "string", enum: ["sender", "carrier", "receiver"] } },
  },
  topic,
  priority,
  status,
  assignee: { ...agentRef, type: ["object", "null"] },
  unread: { type: "integer" },
  lastMessage: {
    type: ["object", "null"],
    required: ["from", "authorId", "authorName", "body", "hasAttachments", "createdAt"],
    properties: {
      from: { type: "string", enum: ["user", "agent"] },
      authorId: { type: ["string", "null"] },
      authorName: { type: "string" },
      body: { type: "string" },
      hasAttachments: { type: "boolean" },
      createdAt: isoDate,
    },
  },
  waitMinutes: { type: "integer" },
  shipment: { type: ["object", "null"], required: ["id", "code"], properties: { id: { type: "string" }, code: { type: "string" } } },
  tags: { type: "array", items: { type: "string" } },
  lastActivityAt: isoDate,
};

const rowRequired = [
  "id", "code", "user", "topic", "priority", "status", "assignee", "unread", "lastMessage", "waitMinutes", "shipment",
  "tags", "lastActivityAt",
];

const row = { type: "object", required: rowRequired, properties: rowProperties };

const conversation = {
  type: "object",
  required: [...rowRequired, "createdAt", "resolvedAt"],
  properties: { ...rowProperties, createdAt: isoDate, resolvedAt: { type: ["string", "null"], format: "date-time" } },
};

// Unión por `kind`: un solo objeto con los campos opcionales de cada variante (Fastify no serializa bien `oneOf`).
const message = {
  type: "object",
  required: ["id", "conversationId", "createdAt", "kind", "body"],
  properties: {
    id: { type: "string" },
    conversationId: { type: "string" },
    createdAt: isoDate,
    clientMessageId: { type: "string" },
    kind: { type: "string", enum: ["user", "agent", "internal_note", "system"] },
    body: { type: "string" },
    attachments: { type: "array", items: attachment },
    author: agentRef,
    actor: { ...agentRef, type: ["object", "null"] },
  },
};

const counts = {
  type: "object",
  required: ["byStatus", "byOwner", "unreadTotal"],
  properties: {
    byStatus: {
      type: "object",
      required: ["open", "awaiting_user", "resolved"],
      properties: { open: { type: "integer" }, awaiting_user: { type: "integer" }, resolved: { type: "integer" } },
    },
    byOwner: {
      type: "object",
      required: ["all", "mine", "none"],
      properties: { all: { type: "integer" }, mine: { type: "integer" }, none: { type: "integer" } },
    },
    unreadTotal: { type: "integer" },
  },
};

const listFilters = {
  status,
  assignee: { type: "string", pattern: "^(me|none|[0-9a-fA-F-]{36})$" },
  q: { type: "string", maxLength: 100 },
};

const event = {
  type: "object",
  required: ["type", "cursor"],
  properties: {
    type: { type: "string", enum: ["conversation_created", "support_message", "conversation_updated", "counts_updated"] },
    cursor: { type: "string" },
    conversationId: { type: "string" },
    conversation: row,
    message,
    counts,
  },
};

const historyItem = {
  type: "object",
  required: ["conversationId", "code", "topic", "status", "createdAt"],
  properties: { conversationId: { type: "string" }, code: { type: "string" }, topic, status, createdAt: isoDate },
};

const context = {
  type: "object",
  required: ["profile", "badges", "recentShipments", "otherConversations"],
  properties: {
    profile: {
      type: "object",
      required: ["id", "fullName", "roles", "memberSince", "email", "phone", "ratingAverage", "ratingCount", "shipmentCount", "tripCount"],
      properties: {
        id: { type: "string" },
        fullName: { type: "string" },
        roles: { type: "array", items: { type: "string" } },
        memberSince: isoDate,
        email: { type: "string" },
        phone: { type: "string" },
        ratingAverage: { type: ["number", "null"] },
        ratingCount: { type: "integer" },
        shipmentCount: { type: "integer" },
        tripCount: { type: "integer" },
      },
    },
    badges: { type: ["array", "null"], items: { type: "string", enum: ["identity", "kyc_approved", "kyc_pending", "license_valid"] } },
    recentShipments: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "code", "status", "route", "tone", "statusLabel", "createdAt"],
        properties: {
          id: { type: "string" },
          code: { type: "string" },
          status: { type: "string" },
          route: { type: "string" },
          tone: { type: "string", enum: ["success", "danger", "info", "warning", "neutral"] },
          statusLabel: { type: "string" },
          createdAt: isoDate,
        },
      },
    },
    otherConversations: { type: "array", items: historyItem },
  },
};

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

const errors = { 401: errorResponse, 403: errorResponse, 404: errorResponse, 502: errorResponse };

export const supportSchemas = {
  list: {
    querystring: {
      type: "object",
      required: ["status"],
      properties: { ...listFilters, cursor: { type: "string", minLength: 1, maxLength: 300 } },
    },
    response: {
      200: { type: "object", required: ["items", "nextCursor"], properties: { items: { type: "array", items: row }, nextCursor: { type: ["string", "null"] } } },
      400: errorResponse,
      ...errors,
    },
  },
  counts: {
    querystring: { type: "object", required: ["status"], properties: listFilters },
    response: { 200: counts, 400: errorResponse, ...errors },
  },
  conversation: { params: idParam, response: { 200: conversation, ...errors } },
  messages: {
    params: idParam,
    querystring: { type: "object", properties: { cursor: { type: "string", minLength: 1, maxLength: 200 } } },
    response: {
      200: { type: "object", required: ["items", "nextCursor"], properties: { items: { type: "array", items: message }, nextCursor: { type: ["string", "null"] } } },
      400: errorResponse,
      ...errors,
    },
  },
  send: {
    params: idParam,
    // El recorte y el vacío (válido solo con adjuntos) los valida svc-shipments; el tope de 4 adjuntos también (422).
    body: {
      type: "object",
      required: ["body", "clientMessageId"],
      properties: {
        body: { type: "string", maxLength: SUPPORT_MESSAGE_MAX_LENGTH * 2 },
        clientMessageId: uuid,
        internal: { type: "boolean" },
        attachmentIds: { type: "array", maxItems: 16, items: uuid },
      },
      additionalProperties: false,
    },
    response: { 200: message, 400: errorResponse, 422: errorResponse, ...errors },
  },
  patch: {
    params: idParam,
    body: {
      type: "object",
      minProperties: 1,
      properties: {
        assignedTo: { type: ["string", "null"], format: "uuid" },
        priority,
        topic,
        tags: { type: "array", maxItems: SUPPORT_TAGS.length, uniqueItems: true, items: tag },
        shipmentId: { type: ["string", "null"], format: "uuid" },
      },
      additionalProperties: false,
    },
    response: { 200: conversation, 400: errorResponse, 422: errorResponse, ...errors },
  },
  action: { params: idParam, response: { 200: conversation, ...errors } },
  read: { params: idParam, response: { 204: { type: "null" }, ...errors } },
  context: { params: idParam, response: { 200: context, ...errors } },
  agents: {
    response: {
      200: {
        type: "array",
        items: { type: "object", required: ["id", "fullName", "activeCount"], properties: { id: { type: "string" }, fullName: { type: "string" }, activeCount: { type: "integer" } } },
      },
      ...errors,
    },
  },
  quickReplies: {
    response: {
      200: {
        type: "array",
        items: { type: "object", required: ["id", "title", "text"], properties: { id: { type: "string" }, title: { type: "string" }, text: { type: "string" } } },
      },
      ...errors,
    },
  },
  events: {
    querystring: { type: "object", properties: { since: { type: "string", maxLength: 50 } } },
    response: {
      200: {
        type: "object",
        required: ["events", "cursor", "reset"],
        properties: { events: { type: "array", items: event }, cursor: { type: "string" }, reset: { type: "boolean" } },
      },
      400: errorResponse,
      ...errors,
    },
  },
  realtimeTicket: {
    response: {
      200: {
        type: "object",
        required: ["ticket", "url", "expiresAt"],
        properties: { ticket: { type: "string" }, url: { type: "string" }, expiresAt: isoDate },
      },
      ...errors,
    },
  },
  attachments: {
    body: {
      type: "object",
      required: ["contentType", "sizeBytes", "conversationId"],
      properties: {
        contentType: { type: "string", maxLength: 100 },
        sizeBytes: { type: "integer" },
        conversationId: uuid,
        width: { type: "integer", minimum: 1, maximum: 20000 },
        height: { type: "integer", minimum: 1, maximum: 20000 },
      },
      additionalProperties: false,
    },
    response: {
      201: {
        type: "object",
        required: ["attachmentId", "uploadUrl", "expiresAt"],
        properties: { attachmentId: { type: "string" }, uploadUrl: { type: "string" }, expiresAt: isoDate },
      },
      422: errorResponse,
      429: errorResponse,
      ...errors,
    },
  },
};
