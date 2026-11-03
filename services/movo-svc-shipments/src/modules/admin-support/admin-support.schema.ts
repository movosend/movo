import { SUPPORT_MESSAGE_MAX_LENGTH, SUPPORT_PRIORITIES, SUPPORT_STATUSES, SUPPORT_TAGS, SUPPORT_TOPICS } from "@movo/shared";

// MOVO-322: wire contract de `/internal/admin/support/*` (`SupportInternal*` de @movo/shared). Autocontenido a propósito,
// mismo criterio que el resto de los *.schema.ts del repo.

const uuid = { type: "string", format: "uuid" } as const;
const status = { type: "string", enum: [...SUPPORT_STATUSES] };
const priority = { type: "string", enum: [...SUPPORT_PRIORITIES] };
const topic = { type: "string", enum: [...SUPPORT_TOPICS] };
const tag = { type: "string", enum: [...SUPPORT_TAGS] };

const conversationIdParam = { type: "object", required: ["id"], properties: { id: uuid } };

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

const row = {
  type: "object",
  required: [
    "id", "code", "userId", "topic", "priority", "status", "assignedTo", "unread", "lastMessage", "waitMinutes",
    "shipment", "tags", "lastActivityAt", "createdAt", "resolvedAt",
  ],
  properties: {
    id: { type: "string" },
    code: { type: "string" },
    userId: { type: "string" },
    topic,
    priority,
    status,
    assignedTo: { type: ["string", "null"] },
    unread: { type: "integer" },
    lastMessage: {
      type: ["object", "null"],
      required: ["from", "authorId", "body", "hasAttachments", "createdAt"],
      properties: {
        from: { type: "string", enum: ["user", "agent"] },
        authorId: { type: ["string", "null"] },
        body: { type: "string" },
        hasAttachments: { type: "boolean" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
    waitMinutes: { type: "integer" },
    shipment: {
      type: ["object", "null"],
      required: ["id", "code"],
      properties: { id: { type: "string" }, code: { type: "string" } },
    },
    tags: { type: "array", items: { type: "string" } },
    lastActivityAt: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    resolvedAt: { type: ["string", "null"], format: "date-time" },
  },
};

const message = {
  type: "object",
  required: ["id", "conversationId", "kind", "authorId", "authorName", "body", "clientMessageId", "attachments", "createdAt"],
  properties: {
    id: { type: "string" },
    conversationId: { type: "string" },
    kind: { type: "string", enum: ["user", "agent", "note", "system", "event"] },
    authorId: { type: ["string", "null"] },
    authorName: { type: ["string", "null"] },
    body: { type: "string" },
    clientMessageId: { type: ["string", "null"] },
    attachments: { type: "array", items: attachment },
    createdAt: { type: "string", format: "date-time" },
  },
};

const actorFields = {
  actorId: uuid,
  actorFullName: { type: "string", minLength: 1, maxLength: 200 },
};

// `assignee`: un id de agente o `none` (`me` ya llega resuelto por svc-admin). `userIds`: ids separados por coma.
const listFilters = {
  status,
  assignee: { type: "string", pattern: "^(none|[0-9a-fA-F-]{36})$" },
  q: { type: "string", maxLength: 100 },
  userIds: { type: "string", maxLength: 50 * 37 },
};

const listQuery = {
  type: "object",
  required: ["status"],
  properties: { ...listFilters, cursor: { type: "string", minLength: 1, maxLength: 300 } },
};

const countsQuery = {
  type: "object",
  required: ["status", "viewerId"],
  properties: { ...listFilters, viewerId: uuid },
};

const listResponse = {
  type: "object",
  required: ["items", "nextCursor"],
  properties: { items: { type: "array", items: row }, nextCursor: { type: ["string", "null"] } },
};

const countsResponse = {
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

const messagesQuery = { type: "object", properties: { cursor: { type: "string", minLength: 1, maxLength: 200 } } };

const messagesResponse = {
  type: "object",
  required: ["items", "nextCursor"],
  properties: { items: { type: "array", items: message }, nextCursor: { type: ["string", "null"] } },
};

// `body` con `maxLength` de AJV como primera barrera; el recorte y el vacío (válido solo con adjuntos) los valida el
// servicio. El tope de 4 adjuntos también, para responder 422 SUPPORT_ATTACHMENT_INVALID.
const sendBody = {
  type: "object",
  required: ["actorId", "actorFullName", "actorFirstName", "body", "clientMessageId"],
  properties: {
    ...actorFields,
    actorFirstName: { type: "string", minLength: 1, maxLength: 100 },
    body: { type: "string", maxLength: SUPPORT_MESSAGE_MAX_LENGTH * 2 },
    clientMessageId: uuid,
    internal: { type: "boolean" },
    attachmentIds: { type: "array", maxItems: 16, items: uuid },
  },
  additionalProperties: false,
};

const sendResponse = {
  type: "object",
  required: ["message", "conversation"],
  properties: { message, conversation: row },
};

const patchBody = {
  type: "object",
  required: ["actorId", "actorFullName"],
  properties: {
    ...actorFields,
    assignedTo: { type: ["string", "null"], format: "uuid" },
    assigneeFullName: { type: "string", minLength: 1, maxLength: 200 },
    priority,
    topic,
    tags: { type: "array", maxItems: SUPPORT_TAGS.length, uniqueItems: true, items: tag },
    shipmentId: { type: ["string", "null"], format: "uuid" },
  },
  additionalProperties: false,
};

const actorBody = {
  type: "object",
  required: ["actorId", "actorFullName"],
  properties: actorFields,
  additionalProperties: false,
};

const attachmentBody = {
  type: "object",
  required: ["actorId", "actorFullName", "contentType", "sizeBytes"],
  properties: {
    ...actorFields,
    contentType: { type: "string", maxLength: 100 },
    sizeBytes: { type: "integer" },
    width: { type: "integer", minimum: 1, maximum: 20000 },
    height: { type: "integer", minimum: 1, maximum: 20000 },
  },
  additionalProperties: false,
};

const attachmentResponse = {
  type: "object",
  required: ["attachmentId", "uploadUrl", "expiresAt"],
  properties: {
    attachmentId: { type: "string" },
    uploadUrl: { type: "string" },
    expiresAt: { type: "string", format: "date-time" },
  },
};

const agentLoadsResponse = {
  type: "array",
  items: {
    type: "object",
    required: ["agentId", "activeCount"],
    properties: { agentId: { type: "string" }, activeCount: { type: "integer" } },
  },
};

const partiesResponse = { type: "object", required: ["userId"], properties: { userId: { type: "string" } } };

const userConversationsResponse = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["conversationId", "code", "topic", "status", "createdAt"],
        properties: {
          conversationId: { type: "string" },
          code: { type: "string" },
          topic,
          status,
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
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

export const adminSupportSchemas = {
  conversationIdParam,
  row,
  listQuery,
  countsQuery,
  listResponse,
  countsResponse,
  messagesQuery,
  messagesResponse,
  sendBody,
  sendResponse,
  patchBody,
  actorBody,
  attachmentBody,
  attachmentResponse,
  agentLoadsResponse,
  partiesResponse,
  userConversationsResponse,
  errorResponse,
};
