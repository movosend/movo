// Autocontenido a propósito (no importa de otros *.schema.ts) — mismo criterio que
// shipments.schema.ts: cada schema no comparte definiciones entre sí.

// Alineado 1:1 con OfferStatus de @movo/shared (MOVO-102) — agregar un valor nuevo
// ahí obliga a actualizar esta lista también.
const OFFER_STATUS_VALUES = ["pending", "accepted", "rejected", "withdrawn", "expired", "superseded"];

// Alineado 1:1 con el enum `PackageType` de Prisma (MOVO-185) — mismo criterio
// autocontenido que PACKAGE_TYPE_VALUES en shipments.schema.ts, sin importar de ahí.
const PACKAGE_TYPE_VALUES = ["letter_document", "standard_package", "fragile_item"];

// "HH:MM" o "HH:MM:SS", sin offset — mismo patrón que TIME_PATTERN en
// shipments.schema.ts (autocontenido a propósito, no se importa de ahí).
const TIME_PATTERN = "^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$";

const offerShipmentContextResponse = {
  type: "object",
  required: [
    "id",
    "status",
    "pickupAddress",
    "pickupDate",
    "pickupTimeWindowStart",
    "pickupTimeWindowEnd",
    "deliveryAddress",
    "distanceKm",
    "packageType",
    "weightKg",
    "description",
  ],
  properties: {
    id: { type: "string" },
    status: { type: "string" },
    pickupAddress: { type: "string" },
    pickupDate: { type: "string", format: "date" },
    // Ventana horaria de retiro PEDIDA POR EL EMISOR (no la de la oferta) -- ver el
    // comentario de `OfferShipmentContext` en `models/offer.ts`.
    pickupTimeWindowStart: { type: "string", format: "time" },
    pickupTimeWindowEnd: { type: "string", format: "time" },
    deliveryAddress: { type: "string" },
    // MOVO-185: distancia Haversine pickup->delivery, redondeada a 1 decimal --
    // nunca lat/lng crudos (ningún consumidor los pide todavía).
    distanceKm: { type: "number" },
    packageType: { type: "string", enum: PACKAGE_TYPE_VALUES },
    weightKg: { type: "number" },
    description: { type: ["string", "null"] },
  },
};

const offerResponse = {
  type: "object",
  required: [
    "id",
    "shipmentId",
    "carrierId",
    "priceOffered",
    "priceNetArs",
    "commissionAmountArs",
    "offeredDate",
    "offeredPickupTimeWindowStart",
    "offeredPickupTimeWindowEnd",
    "message",
    "carrierRatingAtOffer",
    "carrierNameAtOffer",
    "senderNameAtOffer",
    "senderVerifiedAtOffer",
    "senderRatingAtOffer",
    "status",
    "expiresAt",
    "createdAt",
    "respondedAt",
    "tripId",
    "estimatedDeliveryDate",
    "estimatedDeliveryTimeWindowStart",
    "estimatedDeliveryTimeWindowEnd",
    "viewedAtBySender",
  ],
  properties: {
    id: { type: "string" },
    shipmentId: { type: "string" },
    carrierId: { type: "string" },
    priceOffered: { type: "number" },
    // MOVO-186: desglose derivado de priceOffered (bruto) con la tasa de comisión
    // vigente AL MOMENTO DE LA LECTURA, no la que regía al ofertar -- mismo criterio
    // que offersSummary/competitiveRank (MOVO-180/188).
    priceNetArs: { type: "number" },
    commissionAmountArs: { type: "number" },
    // Bug reportado por el usuario en la pantalla de detalle de oferta: `offeredDate`
    // es `@db.Date` (mismo gotcha de timezone de MOVO-80/180) y `offer.dto.ts` ya lo
    // formatea date-only (slice(0,10)) -- declararlo acá como "date-time" hacía que
    // fast-json-stringify lo re-serializara como instante completo en vez de dejar
    // pasar el string recortado tal cual (mismo criterio que estimatedDeliveryDate).
    offeredDate: { type: "string", format: "date" },
    // MOVO-177: null cuando la oferta usa la ventana del envío tal cual.
    offeredPickupTimeWindowStart: { type: ["string", "null"] },
    offeredPickupTimeWindowEnd: { type: ["string", "null"] },
    message: { type: ["string", "null"] },
    carrierRatingAtOffer: { type: ["number", "null"] },
    carrierNameAtOffer: { type: ["string", "null"] },
    // MOVO-187: snapshot simétrico del emisor -- ver el comentario del mismo campo en
    // el modelo de dominio (models/offer.ts).
    senderNameAtOffer: { type: ["string", "null"] },
    senderVerifiedAtOffer: { type: ["boolean", "null"] },
    senderRatingAtOffer: { type: ["number", "null"] },
    status: { type: "string" },
    expiresAt: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    respondedAt: { type: ["string", "null"], format: "date-time" },
    // MOVO-162: viaje declarado del que esta oferta forma parte, si corresponde.
    tripId: { type: ["string", "null"] },
    // MOVO-180: entrega estimada (día + franja), opcional al ofertar -- date-only
    // (@db.Date), mismo criterio que myOfferResponse/shipmentResponse.
    estimatedDeliveryDate: { type: ["string", "null"], format: "date" },
    estimatedDeliveryTimeWindowStart: { type: ["string", "null"], pattern: TIME_PATTERN },
    estimatedDeliveryTimeWindowEnd: { type: ["string", "null"], pattern: TIME_PATTERN },
    // MOVO-189: instante crudo en que el EMISOR vio esta oferta por primera vez -- la
    // traducción a copy ("Vista hace 40 min"/"Todavía no la vio") es de UI (mobile).
    viewedAtBySender: { type: ["string", "null"], format: "date-time" },
  },
};

// MOVO-188 (AC1-AC4): agregado, deliberadamente sin identidad de los competidores.
// `null` si la oferta no está pending o su envío ya no acepta ofertas.
const competitiveRankResponse = {
  type: ["object", "null"],
  required: ["rank", "total", "lowestPriceNetArs", "highestPriceNetArs"],
  properties: {
    rank: { type: "integer" },
    total: { type: "integer" },
    lowestPriceNetArs: { type: "number" },
    highestPriceNetArs: { type: "number" },
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
    "priceNetArs",
    "commissionAmountArs",
    "offeredDate",
    "offeredPickupTimeWindowStart",
    "offeredPickupTimeWindowEnd",
    "message",
    "carrierRatingAtOffer",
    "carrierNameAtOffer",
    "senderNameAtOffer",
    "senderVerifiedAtOffer",
    "senderRatingAtOffer",
    "status",
    "expiresAt",
    "createdAt",
    "respondedAt",
    "shipment",
    "tripId",
    "estimatedDeliveryDate",
    "estimatedDeliveryTimeWindowStart",
    "estimatedDeliveryTimeWindowEnd",
    "competitiveRank",
    "viewedAtBySender",
  ],
  properties: {
    id: { type: "string" },
    shipmentId: { type: "string" },
    carrierId: { type: "string" },
    priceOffered: { type: "number" },
    // MOVO-186: mismo criterio que offerResponse -- ver el comentario de ahí.
    priceNetArs: { type: "number" },
    commissionAmountArs: { type: "number" },
    offeredDate: { type: "string", format: "date" },
    offeredPickupTimeWindowStart: { type: ["string", "null"] },
    offeredPickupTimeWindowEnd: { type: ["string", "null"] },
    message: { type: ["string", "null"] },
    carrierRatingAtOffer: { type: ["number", "null"] },
    carrierNameAtOffer: { type: ["string", "null"] },
    // MOVO-187: snapshot simétrico del emisor -- ver el comentario del mismo campo en
    // el modelo de dominio (models/offer.ts).
    senderNameAtOffer: { type: ["string", "null"] },
    senderVerifiedAtOffer: { type: ["boolean", "null"] },
    senderRatingAtOffer: { type: ["number", "null"] },
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
    estimatedDeliveryTimeWindowStart: { type: ["string", "null"], pattern: TIME_PATTERN },
    estimatedDeliveryTimeWindowEnd: { type: ["string", "null"], pattern: TIME_PATTERN },
    competitiveRank: competitiveRankResponse,
    // MOVO-189: mismo criterio que offerResponse -- instante crudo, sin copy.
    viewedAtBySender: { type: ["string", "null"], format: "date-time" },
  },
};

/**
 * MOVO-181 (AC1/AC3): los 3 campos editables de una oferta `pending`, mismas
 * validaciones de forma que `createOfferBody` (shipments.schema.ts) para
 * `offeredDate`/las franjas -- both-or-neither de la franja horaria se valida en el
 * servicio (AJV no expresa bien esa dependencia condicional de a pares, mismo
 * criterio ya documentado ahí). `minProperties: 1`: un PATCH sin ningún campo no es
 * una edición válida.
 */
const patchOfferBody = {
  type: "object",
  minProperties: 1,
  properties: {
    priceOfferedArs: { type: "number", exclusiveMinimum: 0 },
    offeredDate: { type: "string", format: "date" },
    // ["string", "null"], no solo "string": null es el valor documentado en
    // UpdateOfferInput (models/offer.ts) para volver a "usa la ventana del envío tal
    // cual" -- sin el tipo null acá, ese caso quedaba inalcanzable por HTTP (bug de
    // review, PR #152), rechazado con un 400 de AJV antes de llegar a offers.service.ts.
    offeredPickupTimeWindowStart: { type: ["string", "null"], pattern: TIME_PATTERN },
    offeredPickupTimeWindowEnd: { type: ["string", "null"], pattern: TIME_PATTERN },
  },
  additionalProperties: false,
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

  // MOVO-190: mismo shape que un ítem de `listMineResponse` -- alias directo, sin
  // duplicar la definición (evita repetir el gap ya documentado de
  // shipments.schema.ts#offerResponse, que quedó sin priceNetArs/commissionAmountArs
  // por no reusar el shape correcto).
  offerDetailResponse: myOfferResponse,

  patchOfferBody,

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
