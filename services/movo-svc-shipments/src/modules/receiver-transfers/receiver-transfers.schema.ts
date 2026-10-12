import { RECEIVER_TRANSFER_STATUSES } from "@movo/shared";

// MOVO-275 (ADR-038): wire contract de `ReceiverTransferRequest` (@movo/shared).
export const receiverTransferResponse = {
  type: "object",
  required: [
    "id",
    "shipmentId",
    "requestedBy",
    "requesterName",
    "newReceiverId",
    "newReceiverName",
    "reason",
    "responseReason",
    "status",
    "cancelReason",
    "newReceiverDeadline",
    "createdAt",
    "resolvedAt",
    "resolvedBy",
  ],
  properties: {
    id: { type: "string" },
    shipmentId: { type: "string" },
    requestedBy: { type: "string" },
    requesterName: { type: ["string", "null"] },
    newReceiverId: { type: "string" },
    newReceiverName: { type: ["string", "null"] },
    reason: { type: ["string", "null"] },
    responseReason: { type: ["string", "null"] },
    status: { type: "string", enum: [...RECEIVER_TRANSFER_STATUSES] },
    cancelReason: { type: ["string", "null"], enum: ["requester", "delivery_started", null] },
    newReceiverDeadline: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    resolvedAt: { type: ["string", "null"], format: "date-time" },
    resolvedBy: { type: ["string", "null"] },
  },
};

const invitationResponse = {
  type: "object",
  required: [...receiverTransferResponse.required, "shipment"],
  properties: {
    ...receiverTransferResponse.properties,
    shipment: {
      type: "object",
      required: [
        "id",
        "status",
        "senderId",
        "carrierId",
        "packageType",
        "weightKg",
        "lengthCm",
        "widthCm",
        "heightCm",
        "description",
        "deliveryAddress",
      ],
      properties: {
        id: { type: "string" },
        status: { type: "string" },
        senderId: { type: "string" },
        carrierId: { type: ["string", "null"] },
        packageType: { type: "string" },
        weightKg: { type: "number" },
        lengthCm: { type: "number" },
        widthCm: { type: "number" },
        heightCm: { type: "number" },
        description: { type: ["string", "null"] },
        deliveryAddress: { type: "string" },
      },
    },
  },
};

/** Resumen que viaja en `GET /shipments/:id` (`ShipmentReceiverTransferSummary`). */
export const shipmentReceiverTransferSummary = {
  type: ["object", "null"],
  required: ["viewerIsFormerReceiver", "pending", "completed"],
  properties: {
    viewerIsFormerReceiver: { type: "boolean" },
    pending: { ...receiverTransferResponse, type: ["object", "null"] },
    completed: { ...receiverTransferResponse, type: ["object", "null"] },
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

export const receiverTransfersSchemas = {
  shipmentIdParam: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
  transferIdParam: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
  requestTransferBody: {
    type: "object",
    required: ["newReceiverId"],
    properties: {
      newReceiverId: { type: "string", format: "uuid" },
      reason: { type: "string", maxLength: 500 },
    },
    additionalProperties: false,
  },
  // Body vacío permitido (mismo patrón que `rejectShipmentBody`, MOVO-129).
  rejectTransferBody: {
    type: "object",
    nullable: true,
    properties: {
      reason: { type: "string", maxLength: 500 },
    },
    additionalProperties: false,
  },
  emptyBody: {
    type: "object",
    nullable: true,
    properties: {},
    additionalProperties: false,
  },
  receiverTransferResponse,
  receiverTransferListResponse: { type: "array", items: receiverTransferResponse },
  invitationResponse,
  invitationListResponse: { type: "array", items: invitationResponse },
  errorResponse,
};
