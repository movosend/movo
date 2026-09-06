// Autocontenido a propósito (no importa de otros *.schema.ts) — mismo criterio que
// shipments.schema.ts: cada schema no comparte definiciones entre sí.

// Alineado 1:1 con OfferStatus de @movo/shared (MOVO-102) — agregar un valor nuevo
// ahí obliga a actualizar esta lista también.
const OFFER_STATUS_VALUES = ["pending", "accepted", "rejected", "withdrawn", "expired", "superseded"];

const offerShipmentContextResponse = {
  type: "object",
  required: ["id", "status", "pickupAddress", "pickupDate", "deliveryAddress"],
  properties: {
    id: { type: "string" },
    status: { type: "string" },
    pickupAddress: { type: "string" },
    pickupDate: { type: "string", format: "date" },
    deliveryAddress: { type: "string" },
  },
};

const offerResponse = {
  type: "object",
  required: [
    "id",
    "shipmentId",
    "carrierId",
    "priceOffered",
    "offeredDate",
    "message",
    "carrierRatingAtOffer",
    "carrierNameAtOffer",
    "status",
    "expiresAt",
    "createdAt",
    "respondedAt",
    "tripId",
    "estimatedDeliveryDate",
    "estimatedDeliveryTimeWindowStart",
    "estimatedDeliveryTimeWindowEnd",
  ],
  properties: {
    id: { type: "string" },
    shipmentId: { type: "string" },
    carrierId: { type: "string" },
    priceOffered: { type: "number" },
    offeredDate: { type: "string", format: "date-time" },
    message: { type: ["string", "null"] },
    carrierRatingAtOffer: { type: ["number", "null"] },
    carrierNameAtOffer: { type: ["string", "null"] },
    status: { type: "string" },
    expiresAt: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    respondedAt: { type: ["string", "null"], format: "date-time" },
    // MOVO-162: viaje declarado del que esta oferta forma parte, si corresponde.
    tripId: { type: ["string", "null"] },
    // MOVO-180: entrega estimada (día + franja), opcional al ofertar.
    estimatedDeliveryDate: { type: ["string", "null"], format: "date-time" },
    estimatedDeliveryTimeWindowStart: { type: ["string", "null"] },
    estimatedDeliveryTimeWindowEnd: { type: ["string", "null"] },
  },
};

// MOVO-145 (GET /offers/mine): a diferencia de `offerResponse` (accept/reject, sin
// contexto de envío), acá `offeredDate` sale ya formateado como date-only (mismo gotcha
// de timezone que `offerShipmentContextResponse.pickupDate`) y suma el contexto mínimo
// del envío resuelto en la misma query (AC4/AC5).
const myOfferResponse = {
  type: "object",
  required: [
    "id",
    "shipmentId",
    "carrierId",
    "priceOffered",
    "offeredDate",
    "message",
    "carrierRatingAtOffer",
    "carrierNameAtOffer",
    "status",
    "expiresAt",
    "createdAt",
    "respondedAt",
    "shipment",
    "tripId",
    "estimatedDeliveryDate",
    "estimatedDeliveryTimeWindowStart",
    "estimatedDeliveryTimeWindowEnd",
  ],
  properties: {
    id: { type: "string" },
    shipmentId: { type: "string" },
    carrierId: { type: "string" },
    priceOffered: { type: "number" },
    offeredDate: { type: "string", format: "date" },
    message: { type: ["string", "null"] },
    carrierRatingAtOffer: { type: ["number", "null"] },
    carrierNameAtOffer: { type: ["string", "null"] },
    // AC2: valor EFECTIVO (deriveEffectiveOfferStatus ya aplicado, incluye "expired").
    status: { type: "string", enum: OFFER_STATUS_VALUES },
    expiresAt: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    respondedAt: { type: ["string", "null"], format: "date-time" },
    // AC4/AC5: contexto mínimo del envío, incluye su status real (ej. "assignment_pending"
    // cuando esta oferta es la que ganó, AC5).
    shipment: offerShipmentContextResponse,
    // MOVO-162: viaje declarado del que esta oferta forma parte, si corresponde.
    tripId: { type: ["string", "null"] },
    // MOVO-180: mismo gotcha de timezone que offeredDate -- date-only, formateado a
    // mano en toMyOfferDto (offers.routes.ts), nunca por el serializador "date".
    estimatedDeliveryDate: { type: ["string", "null"], format: "date" },
    estimatedDeliveryTimeWindowStart: { type: ["string", "null"] },
    estimatedDeliveryTimeWindowEnd: { type: ["string", "null"] },
  },
};

export const offersSchemas = {
  listMineQuery: {
    type: "object",
    properties: {
      status: { type: "string", enum: OFFER_STATUS_VALUES },
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    },
  },

  offerResponse,

  listMineResponse: {
    type: "object",
    required: ["items", "page", "limit", "total"],
    properties: {
      items: { type: "array", items: myOfferResponse },
      page: { type: "integer" },
      limit: { type: "integer" },
      total: { type: "integer" },
    },
  },

  offerIdParam: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
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
