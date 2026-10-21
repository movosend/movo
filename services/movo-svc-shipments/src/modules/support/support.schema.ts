import { CHAT_PAGE_MAX_LIMIT, SUPPORT_MESSAGE_MAX_LENGTH, SUPPORT_TOPICS } from "@movo/shared";

// MOVO-320 (ADR-050): wire contract de `SupportConversationItem`/`SupportUserFacingMessage` (@movo/shared).
// Autocontenido a propósito, mismo criterio que chat.schema.ts.

const conversationIdParam = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
};

const topic = { type: "string", enum: [...SUPPORT_TOPICS] };
const status = { type: "string", enum: ["open", "awaiting_user", "resolved"] };

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

const supportMessageResponse = {
  type: "object",
  required: ["id", "conversationId", "kind", "authorName", "body", "clientMessageId", "moderated", "deliveryStatus", "attachments", "createdAt"],
  properties: {
    id: { type: "string" },
    conversationId: { type: "string" },
    // Nunca `note`: las notas internas no llegan al usuario por ningún camino.
    kind: { type: "string", enum: ["user", "agent", "system"] },
    authorName: { type: ["string", "null"] },
    body: { type: "string" },
    clientMessageId: { type: ["string", "null"] },
    moderated: { type: "boolean" },
    deliveryStatus: { type: ["string", "null"], enum: ["sent", "read", null] },
    attachments: { type: "array", items: attachment },
    createdAt: { type: "string", format: "date-time" },
  },
};

const conversationItemResponse = {
  type: "object",
  required: ["id", "code", "topic", "status", "shipment", "lastMessage", "unreadCount", "lastActivityAt"],
  properties: {
    id: { type: "string" },
    code: { type: "string" },
    topic,
    status,
    shipment: {
      type: ["object", "null"],
      required: ["id", "code"],
      properties: { id: { type: "string" }, code: { type: "string" } },
    },
    lastMessage: {
      type: ["object", "null"],
      required: ["from", "authorName", "body", "hasAttachments", "createdAt"],
      properties: {
        from: { type: "string", enum: ["user", "agent"] },
        authorName: { type: ["string", "null"] },
        body: { type: "string" },
        hasAttachments: { type: "boolean" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
    unreadCount: { type: "integer" },
    lastActivityAt: { type: "string", format: "date-time" },
  },
};

// `body` va con `maxLength` de AJV como primera barrera; el `trim` y el mínimo de 1 carácter real los valida
// el servicio (AJV no recorta antes de contar).
const createConversationBody = {
  type: "object",
  required: ["topic", "body", "clientMessageId"],
  properties: {
    topic,
    body: { type: "string", minLength: 1, maxLength: SUPPORT_MESSAGE_MAX_LENGTH * 2 },
    clientMessageId: { type: "string", format: "uuid" },
    shipmentId: { type: "string", format: "uuid" },
    // Reservado para MOVO-321: hasta entonces un valor no vacío responde 422.
    attachmentIds: { type: "array", maxItems: 4, items: { type: "string", format: "uuid" } },
  },
  additionalProperties: false,
};

const createConversationResponse = {
  type: "object",
  required: ["conversation", "message"],
  properties: { conversation: conversationItemResponse, message: supportMessageResponse },
};

const listConversationsResponse = {
  type: "object",
  required: ["items"],
  properties: { items: { type: "array", items: conversationItemResponse } },
};

const sendMessageBody = {
  type: "object",
  required: ["body", "clientMessageId"],
  properties: {
    body: { type: "string", minLength: 1, maxLength: SUPPORT_MESSAGE_MAX_LENGTH * 2 },
    clientMessageId: { type: "string", format: "uuid" },
    attachmentIds: { type: "array", maxItems: 4, items: { type: "string", format: "uuid" } },
  },
  additionalProperties: false,
};

const listMessagesQuery = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: CHAT_PAGE_MAX_LIMIT, default: 30 },
    cursor: { type: "string", minLength: 1, maxLength: 200 },
  },
};

const listMessagesResponse = {
  type: "object",
  required: ["items", "nextCursor", "conversation"],
  properties: {
    items: { type: "array", items: supportMessageResponse },
    nextCursor: { type: ["string", "null"] },
    conversation: conversationItemResponse,
  },
};

const readResponse = {
  type: "object",
  required: ["readAt"],
  properties: { readAt: { type: "string", format: "date-time" } },
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

export const supportSchemas = {
  conversationIdParam,
  createConversationBody,
  createConversationResponse,
  listConversationsResponse,
  sendMessageBody,
  supportMessageResponse,
  listMessagesQuery,
  listMessagesResponse,
  readResponse,
  errorResponse,
};
