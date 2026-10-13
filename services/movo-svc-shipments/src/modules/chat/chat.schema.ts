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
  required: ["id", "shipmentId", "authorId", "body", "clientMessageId", "createdAt"],
  properties: {
    id: { type: "string" },
    shipmentId: { type: "string" },
    authorId: { type: "string" },
    body: { type: "string" },
    clientMessageId: { type: "string" },
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
  required: ["items", "nextCursor", "access"],
  properties: {
    items: { type: "array", items: chatMessageResponse },
    nextCursor: { type: ["string", "null"] },
    access: { type: "string", enum: ["open", "read_only"] },
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

export const chatSchemas = {
  shipmentIdParam,
  sendMessageBody,
  listMessagesQuery,
  chatMessageResponse,
  listMessagesResponse,
  errorResponse,
};
