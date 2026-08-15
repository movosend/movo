// Autocontenido a propósito (no importa de otros *.schema.ts) — mismo criterio que ya
// usa movo-svc-users: cada schema no comparte definiciones entre sí.

const PACKAGE_TYPE_VALUES = ["letter_document", "standard_package", "fragile_item"];

// Placeholder de equipo, documentado explícitamente (mismo criterio que
// MAX_PHOTO_CONTENT_LENGTH_BYTES en movo-svc-users/MOVO-97) — a confirmar con el
// equipo qué puede transportar realmente un transportista en bici/auto. Ajustable sin
// migración, es solo un bound de AJV.
const WEIGHT_KG_MIN = 0.1;
const WEIGHT_KG_MAX = 30;
const DIMENSION_CM_MIN = 1;
const DIMENSION_CM_MAX = 150;

// "HH:MM" o "HH:MM:SS", sin offset — a propósito no se usa `format: "time"` de AJV: ese
// format exige el time-offset de RFC 3339 (full-time), y acá se quiere una hora local
// simple sin zona horaria.
const TIME_PATTERN = "^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$";

const shipmentResponse = {
  type: "object",
  required: [
    "id",
    "senderId",
    "receiverId",
    "carrierId",
    "packageType",
    "weightKg",
    "lengthCm",
    "widthCm",
    "heightCm",
    "description",
    "urgent",
    "pickupAddress",
    "pickupLat",
    "pickupLng",
    "deliveryAddress",
    "deliveryLat",
    "deliveryLng",
    "pickupDate",
    "pickupTimeWindowStart",
    "pickupTimeWindowEnd",
    "suggestedPriceArs",
    "agreedPriceArs",
    "paymentMethod",
    "status",
    "lastStatusChangedAt",
    "deliveredAt",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    senderId: { type: "string" },
    receiverId: { type: "string" },
    carrierId: { type: ["string", "null"] },
    packageType: { type: "string", enum: PACKAGE_TYPE_VALUES },
    weightKg: { type: "number" },
    lengthCm: { type: "number" },
    widthCm: { type: "number" },
    heightCm: { type: "number" },
    description: { type: ["string", "null"] },
    urgent: { type: "boolean" },
    pickupAddress: { type: "string" },
    pickupLat: { type: "number" },
    pickupLng: { type: "number" },
    deliveryAddress: { type: "string" },
    deliveryLat: { type: "number" },
    deliveryLng: { type: "number" },
    pickupDate: { type: "string", format: "date" },
    pickupTimeWindowStart: { type: "string", format: "time" },
    pickupTimeWindowEnd: { type: "string", format: "time" },
    suggestedPriceArs: { type: "number" },
    agreedPriceArs: { type: ["number", "null"] },
    paymentMethod: { type: ["string", "null"] },
    status: { type: "string" },
    lastStatusChangedAt: { type: ["string", "null"], format: "date-time" },
    deliveredAt: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

export const shipmentsSchemas = {
  createShipmentBody: {
    type: "object",
    required: [
      "packageType",
      "weightKg",
      "lengthCm",
      "widthCm",
      "heightCm",
      "receiverId",
      "pickupAddress",
      "pickupLat",
      "pickupLng",
      "deliveryAddress",
      "deliveryLat",
      "deliveryLng",
      "pickupDate",
      "pickupTimeWindowStart",
      "pickupTimeWindowEnd",
    ],
    properties: {
      packageType: { type: "string", enum: PACKAGE_TYPE_VALUES },
      weightKg: { type: "number", minimum: WEIGHT_KG_MIN, maximum: WEIGHT_KG_MAX },
      lengthCm: { type: "number", minimum: DIMENSION_CM_MIN, maximum: DIMENSION_CM_MAX },
      widthCm: { type: "number", minimum: DIMENSION_CM_MIN, maximum: DIMENSION_CM_MAX },
      heightCm: { type: "number", minimum: DIMENSION_CM_MIN, maximum: DIMENSION_CM_MAX },
      description: { type: "string", maxLength: 500 },
      // `senderId` NUNCA se acepta acá (AC10 de MOVO-80) — si el cliente lo manda
      // igual, `additionalProperties: false` lo rechaza en vez de ignorarlo en
      // silencio, así el error es explícito en vez de una falsa sensación de éxito.
      receiverId: { type: "string", format: "uuid" },
      pickupAddress: { type: "string", minLength: 1 },
      pickupLat: { type: "number", minimum: -90, maximum: 90 },
      pickupLng: { type: "number", minimum: -180, maximum: 180 },
      deliveryAddress: { type: "string", minLength: 1 },
      deliveryLat: { type: "number", minimum: -90, maximum: 90 },
      deliveryLng: { type: "number", minimum: -180, maximum: 180 },
      pickupDate: { type: "string", format: "date" },
      pickupTimeWindowStart: { type: "string", pattern: TIME_PATTERN },
      pickupTimeWindowEnd: { type: "string", pattern: TIME_PATTERN },
    },
    additionalProperties: false,
  },

  shipmentIdParam: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
    },
  },

  listMineQuery: {
    type: "object",
    properties: {
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    },
  },

  shipmentResponse,

  listMineResponse: {
    type: "object",
    required: ["items", "page", "limit", "total"],
    properties: {
      items: { type: "array", items: shipmentResponse },
      page: { type: "integer" },
      limit: { type: "integer" },
      total: { type: "integer" },
    },
  },

  errorResponse: {
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
        },
      },
      requestId: { type: "string" },
    },
  },
};
