import { CHAT_MESSAGE_MAX_LENGTH, CHAT_PAGE_MAX_LIMIT } from "@movo/shared";

// MOVO-26 (ADR-040): wire contract de `ChatMessage`/`ChatMessagesPage` (@movo/shared).
// Autocontenido a propósito, mismo criterio que ratings.schema.ts/handshake.schema.ts.

const shipmentIdParam = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
};

const chatMessageResponse = {
  type: "object",
  required: ["id", "shipmentId", "authorId", "authorName", "body", "clientMessageId", "moderated", "hidden", "deliveryStatus", "createdAt"],
  properties: {
    id: { type: "string" },
    shipmentId: { type: "string" },
    authorId: { type: "string" },
    authorName: { type: ["string", "null"] },
    body: { type: "string" },
    clientMessageId: { type: "string" },
    moderated: { type: "boolean" },
    hidden: { type: "boolean" },
    deliveryStatus: { type: ["string", "null"], enum: ["sent", "delivered", "read", null] },
    createdAt: { type: "string", format: "date-time" },
  },
};

// `body` va con `maxLength` de AJV como primera barrera; el `trim` y el mínimo de 1 carácter
// real los valida el servicio (AJV no recorta antes de contar).
const sendMessageBody = {
  type: "object",
  required: ["body", "clientMessageId"],
  properties: {
    body: { type: "string", minLength: 1, maxLength: CHAT_MESSAGE_MAX_LENGTH * 2 },
    clientMessageId: { type: "string", format: "uuid" },
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
  required: ["items", "nextCursor", "access", "archived", "reportedByMe"],
  properties: {
    items: { type: "array", items: chatMessageResponse },
    nextCursor: { type: ["string", "null"] },
    access: { type: "string", enum: ["open", "read_only"] },
    archived: { type: "boolean" },
    reportedByMe: { type: "boolean" },
  },
};

const participantItem = {
  type: "object",
  required: ["userId", "role", "firstName", "fullName", "photoUrl"],
  properties: {
    userId: { type: "string" },
    role: { type: "string", enum: ["sender", "carrier", "receiver"] },
    firstName: { type: "string" },
    fullName: { type: "string" },
    photoUrl: { type: ["string", "null"] },
  },
};

const participantsResponse = {
  type: "object",
  required: ["participants"],
  properties: {
    participants: { type: "array", items: participantItem },
  },
};

const chatListResponse = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["shipmentId", "status", "route", "access", "archived", "unreadCount", "lastMessage", "lastActivityAt", "participants"],
        properties: {
          shipmentId: { type: "string" },
          status: { type: "string" },
          route: { type: "string" },
          access: { type: "string", enum: ["open", "read_only"] },
          archived: { type: "boolean" },
          unreadCount: { type: "integer" },
          lastMessage: {
            type: ["object", "null"],
            required: ["authorId", "authorName", "body", "hidden", "createdAt"],
            properties: {
              authorId: { type: "string" },
              authorName: { type: ["string", "null"] },
              body: { type: "string" },
              hidden: { type: "boolean" },
              createdAt: { type: "string", format: "date-time" },
            },
          },
          lastActivityAt: { type: "string", format: "date-time" },
          participants: { type: "array", items: participantItem },
        },
      },
    },
  },
};

const readResponse = {
  type: "object",
  required: ["readAt"],
  properties: { readAt: { type: "string", format: "date-time" } },
};

const reportResponse = {
  type: "object",
  required: ["reported"],
  properties: { reported: { type: "boolean" } },
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

export const chatSchemas = {
  shipmentIdParam,
  sendMessageBody,
  listMessagesQuery,
  chatMessageResponse,
  listMessagesResponse,
  participantsResponse,
  chatListResponse,
  readResponse,
  reportResponse,
  errorResponse,
};
