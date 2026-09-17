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

// MOVO-81/MOVO-196: "creation" (emisor) más "pickup"/"delivery" (evidencia del
// transportista asignado antes del handshake, MOVO-158) -- el dominio (`PhotoStage`,
// `addPhoto`) ya era genérico por stage desde MOVO-104, solo faltaba habilitarlos acá
// y la autorización por stage en `photos.service.ts#assertCanRegisterPhoto`.
const PHOTO_STAGE_VALUES = ["creation", "pickup", "delivery"];

// MOVO-196: subconjunto de PHOTO_STAGE_VALUES con handshake pendiente -- el único
// `stage` que puede devolver GET /:id/evidence-status (`null` para cualquier otro
// estado del envío, sin handshake en curso).
const EVIDENCE_PHOTO_STAGE_VALUES = ["pickup", "delivery"];

// AC10: convención de key `.jpg` -- duplicado en `photos.service.ts`
// (`ALLOWED_PHOTO_CONTENT_TYPE`/`MAX_PHOTO_CONTENT_LENGTH_BYTES`), mismo criterio que
// el resto del repo: si se agrega un tipo/límite acá, agregarlo también ahí.
const PHOTO_CONTENT_TYPE_VALUES = ["image/jpeg"];
const MAX_PHOTO_CONTENT_LENGTH_BYTES = 2 * 1024 * 1024;

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
    "calculationMethod",
    "agreedPriceArs",
    "paymentMethod",
    "status",
    "lastStatusChangedAt",
    "deliveredAt",
    "receiverConfirmationDeadline",
    "createdAt",
    "updatedAt",
    "estimatedDeliveryDate",
    "estimatedDeliveryTimeWindowStart",
    "estimatedDeliveryTimeWindowEnd",
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
    // MOVO-82 AC6: null = "precio a estimar" (movo-svc-pricing-logistics no respondió
    // o faltaban datos al crear el envío). calculationMethod acompaña con la misma
    // nulidad -- ver PriceCalculationMethod en @movo/shared para los valores posibles.
    suggestedPriceArs: { type: ["number", "null"] },
    calculationMethod: { type: ["string", "null"] },
    agreedPriceArs: { type: ["number", "null"] },
    paymentMethod: { type: ["string", "null"] },
    status: { type: "string" },
    lastStatusChangedAt: { type: ["string", "null"], format: "date-time" },
    deliveredAt: { type: ["string", "null"], format: "date-time" },
    receiverConfirmationDeadline: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    // MOVO-180 (adelantado): solo presente en `GET /shipments/:id` cuando el caller es
    // un transportista ajeno viendo un envío `published` -- agregado sin identidad de
    // los competidores, `null`/ausente si no hay ninguna oferta vigente.
    offersSummary: {
      type: ["object", "null"],
      properties: {
        count: { type: "integer" },
        minPriceNetArs: { type: "number" },
      },
    },
    // MOVO-180: entrega estimada de la oferta ganadora, null hasta que el envío tenga
    // una aceptada (o si esa oferta nunca la declaró -- es opcional al ofertar).
    estimatedDeliveryDate: { type: ["string", "null"], format: "date" },
    estimatedDeliveryTimeWindowStart: { type: ["string", "null"], pattern: TIME_PATTERN },
    estimatedDeliveryTimeWindowEnd: { type: ["string", "null"], pattern: TIME_PATTERN },
  },
};

// MOVO-142 (AC9): proyección de GET /shipments/available -- deliberadamente sin
// senderId/receiverId/carrierId/agreedPriceArs/paymentMethod/lastStatusChangedAt/
// deliveredAt/receiverConfirmationDeadline/updatedAt (datos personales o ruido
// operativo irrelevante para quien está descubriendo envíos).
const availableShipmentResponse = {
  type: "object",
  required: [
    "id",
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
    "calculationMethod",
    "status",
    "pickupDistanceKm",
    "deliveryDistanceKm",
    "distanceKm",
    "hasMyOffer",
    "createdAt",
  ],
  properties: {
    id: { type: "string" },
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
    suggestedPriceArs: { type: ["number", "null"] },
    calculationMethod: { type: ["string", "null"] },
    status: { type: "string" },
    // Distancia (Haversine) del retiro al originLat/Lng y de la entrega al
    // destinationLat/Lng del transportista, más la suma (distanceKm, clave de orden).
    // deliveryDistanceKm es null cuando el caller no mandó destino.
    pickupDistanceKm: { type: "number" },
    deliveryDistanceKm: { type: ["number", "null"] },
    distanceKm: { type: "number" },
    hasMyOffer: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
  },
};

const OFFER_SORT_VALUES = ["price", "rating", "createdAt"];

const offerResponse = {
  type: "object",
  required: [
    "id",
    "shipmentId",
    "carrierId",
    "priceOffered",
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
    offeredDate: { type: "string", format: "date-time" },
    // MOVO-177: null cuando la oferta usa la ventana del envío tal cual.
    offeredPickupTimeWindowStart: { type: ["string", "null"] },
    offeredPickupTimeWindowEnd: { type: ["string", "null"] },
    message: { type: ["string", "null"] },
    carrierRatingAtOffer: { type: ["number", "null"] },
    carrierNameAtOffer: { type: ["string", "null"] },
    // MOVO-187: snapshot simétrico del emisor -- ver models/offer.ts.
    senderNameAtOffer: { type: ["string", "null"] },
    senderVerifiedAtOffer: { type: ["boolean", "null"] },
    senderRatingAtOffer: { type: ["number", "null"] },
    status: { type: "string" },
    expiresAt: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    respondedAt: { type: ["string", "null"], format: "date-time" },
    // MOVO-162: viaje declarado del que esta oferta forma parte, si corresponde.
    tripId: { type: ["string", "null"] },
    // MOVO-180: opcional al ofertar -- date-only (@db.Date), no "date-time" como
    // offeredDate en esta misma respuesta: toOfferDto (offer.dto.ts) lo formatea
    // ya recortado (slice(0, 10)), mismo criterio que myOfferResponse/shipmentResponse
    // (feedback de review: el valor no puede salir con dos formatos distintos según
    // el endpoint).
    estimatedDeliveryDate: { type: ["string", "null"], format: "date" },
    estimatedDeliveryTimeWindowStart: { type: ["string", "null"], pattern: TIME_PATTERN },
    estimatedDeliveryTimeWindowEnd: { type: ["string", "null"], pattern: TIME_PATTERN },
    // MOVO-189: instante crudo en que el emisor vio esta oferta por primera vez.
    viewedAtBySender: { type: ["string", "null"], format: "date-time" },
  },
};

/**
 * MOVO-143 (AC6): además de los campos de `offerResponse`, desglosa el NETO que
 * ingresó el transportista y la comisión de Movo ya calculados en el servidor --
 * `priceOffered` sigue siendo el BRUTO (lo que ve el emisor, mismo campo que ya
 * exponía `offerResponse`).
 */
const createOfferResponse = {
  type: "object",
  required: [...offerResponse.required, "priceNetArs", "commissionAmountArs"],
  properties: {
    ...offerResponse.properties,
    priceNetArs: { type: "number" },
    commissionAmountArs: { type: "number" },
  },
};

// MOVO-192: subconjunto "activo" de ShipmentStatus (ver ACTIVE_SHIPMENT_STATUSES en
// shipment-state-machine.ts) -- el único que puede aparecer en la respuesta de
// GET /shipments/sending|transporting|receiving.
const ACTIVE_SHIPMENT_STATUS_VALUES = ["assigned_unfunded", "assigned", "in_transit"];

const activeShipmentSummaryResponse = {
  type: "object",
  required: [
    "id",
    "status",
    "pickupDate",
    "pickupTimeWindowStart",
    "pickupTimeWindowEnd",
    "pickupAddress",
    "deliveryAddress",
    "agreedPriceArs",
    "counterparty",
    "isToday",
    "pickupWindowExpired",
  ],
  properties: {
    id: { type: "string" },
    status: { type: "string", enum: ACTIVE_SHIPMENT_STATUS_VALUES },
    pickupDate: { type: "string", format: "date" },
    pickupTimeWindowStart: { type: "string", format: "time" },
    pickupTimeWindowEnd: { type: "string", format: "time" },
    pickupAddress: { type: "string" },
    deliveryAddress: { type: "string" },
    // MOVO-192 (gap documentado en @movo/shared#ActiveShipmentSummary): sigue nullable
    // en la práctica -- ningún flujo persiste este campo todavía al aceptar una oferta.
    agreedPriceArs: { type: ["number", "null"] },
    counterparty: {
      type: "object",
      required: ["name", "initials"],
      properties: {
        name: { type: "string" },
        initials: { type: "string" },
      },
    },
    isToday: { type: "boolean" },
    pickupWindowExpired: { type: "boolean" },
  },
};

// MOVO-222: mismos 3 valores que `RatingRole` (`models/rating.ts`, enum Prisma) y
// `@movo/shared#RatingRole`.
const RATING_ROLE_VALUES = ["sender", "carrier", "receiver"];

// MOVO-222: único subconjunto de `status` que puede aparecer en la respuesta de
// GET /shipments/pending-ratings -- `findPendingRatingCandidates` ya filtra por
// FULFILLED_SHIPMENT_STATUSES antes de llegar acá.
const PENDING_RATING_STATUS_VALUES = ["delivered", "completed"];

const pendingRatingShipmentResponse = {
  type: "object",
  required: [
    "id",
    "status",
    "deliveredAt",
    "ratingDeadline",
    "senderId",
    "receiverId",
    "carrierId",
    "pendingRatingFor",
  ],
  properties: {
    id: { type: "string" },
    status: { type: "string", enum: PENDING_RATING_STATUS_VALUES },
    deliveredAt: { type: "string", format: "date-time" },
    // MOVO-222 (corregido en review): instante absoluto ya calculado
    // (`computeRatingWindowDeadline`, incluye freeze de disputa) -- el cliente no
    // recalcula 72hs a mano, mismo criterio que `receiverConfirmationDeadline`.
    ratingDeadline: { type: "string", format: "date-time" },
    senderId: { type: "string" },
    receiverId: { type: "string" },
    carrierId: { type: "string" },
    // Nunca vacío -- el servicio solo devuelve ítems con algo pendiente de calificar.
    pendingRatingFor: {
      type: "array",
      items: { type: "string", enum: RATING_ROLE_VALUES },
      minItems: 1,
    },
  },
};

const shipmentEventResponse = {
  type: "object",
  required: ["id", "shipmentId", "fromStatus", "toStatus", "actorId", "reason", "createdAt"],
  properties: {
    id: { type: "string" },
    shipmentId: { type: "string" },
    fromStatus: { type: ["string", "null"] },
    toStatus: { type: "string" },
    actorId: { type: ["string", "null"] },
    reason: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
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

  // MOVO-29/MOVO-108: motivo opcional, texto libre corto -- mismo límite razonable que
  // `description` de `createShipmentBody`, sin un AC que pida uno específico.
  cancelShipmentBody: {
    type: "object",
    properties: {
      reason: { type: "string", maxLength: 500 },
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

  acceptShipmentBody: {
    type: "object",
    nullable: true,
    properties: {},
    additionalProperties: false,
  },

  rejectShipmentBody: {
    type: "object",
    nullable: true,
    properties: {
      reason: { type: "string", maxLength: 500 },
    },
    additionalProperties: false,
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

  // MOVO-142: mismo naming que routeQuery (originLat/originLng/destinationLat/
  // destinationLng) por consistencia -- acá representan el trayecto del transportista,
  // no un origen/destino de ruteo. Solo origin* es obligatorio (AC1 original: el
  // caller no tiene por qué tener un viaje planificado, "cerca mío" alcanza) --
  // destination* es opcional, mandar uno sin el otro es 400 (validado en el service,
  // no acá: AJV no tiene una forma limpia de expresar "ambos o ninguno" sin
  // dependentRequired/if-then, y esta es la única query del schema que lo necesita).
  // radiusKm comparte el mismo tope duro (200) que impide que la query degenere en un
  // full scan; maxDistanceKm es la distancia PROPIA del envío (retiro→entrega), sin
  // default -- si no se manda, no filtra por eso.
  listAvailableQuery: {
    type: "object",
    required: ["originLat", "originLng"],
    properties: {
      originLat: { type: "number", minimum: -90, maximum: 90 },
      originLng: { type: "number", minimum: -180, maximum: 180 },
      destinationLat: { type: "number", minimum: -90, maximum: 90 },
      destinationLng: { type: "number", minimum: -180, maximum: 180 },
      radiusKm: { type: "number", minimum: 1, maximum: 200, default: 50 },
      maxDistanceKm: { type: "number", minimum: 0.1 },
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    },
  },

  availableShipmentResponse,

  listAvailableResponse: {
    type: "object",
    required: ["items", "page", "limit", "total"],
    properties: {
      items: { type: "array", items: availableShipmentResponse },
      page: { type: "integer" },
      limit: { type: "integer" },
      total: { type: "integer" },
    },
  },

  activeShipmentSummaryResponse,

  listActiveShipmentsResponse: {
    type: "array",
    items: activeShipmentSummaryResponse,
  },

  pendingRatingShipmentResponse,

  // MOVO-222: sin paginación (mismo criterio que listActiveShipmentsResponse) -- el
  // volumen realista (envíos entregados en las últimas 72hs con algo pendiente) nunca
  // es grande.
  listPendingRatingsResponse: {
    type: "array",
    items: pendingRatingShipmentResponse,
  },

  routeQuery: {
    type: "object",
    required: ["originLat", "originLng", "destinationLat", "destinationLng"],
    properties: {
      originLat: { type: "number", minimum: -90, maximum: 90 },
      originLng: { type: "number", minimum: -180, maximum: 180 },
      destinationLat: { type: "number", minimum: -90, maximum: 90 },
      destinationLng: { type: "number", minimum: -180, maximum: 180 },
    },
  },

  routeResponse: {
    type: "object",
    required: ["polyline", "distanceMeters", "durationSeconds"],
    properties: {
      polyline: { type: "string" },
      distanceMeters: { type: "number" },
      durationSeconds: { type: "number" },
    },
  },

  // MOVO-170
  historyWithUserIdParam: {
    type: "object",
    required: ["userId"],
    properties: {
      userId: { type: "string", format: "uuid" },
    },
  },

  sharedHistoryResponse: {
    type: "object",
    required: ["sharedShipmentCount", "lastSharedAt", "allDelivered"],
    properties: {
      sharedShipmentCount: { type: "integer" },
      lastSharedAt: { type: ["string", "null"], format: "date-time" },
      allDelivered: { type: "boolean" },
    },
  },

  presignPhotoBody: {
    type: "object",
    required: ["stage", "contentType", "contentLength"],
    properties: {
      stage: { type: "string", enum: PHOTO_STAGE_VALUES },
      contentType: { type: "string", enum: PHOTO_CONTENT_TYPE_VALUES },
      contentLength: { type: "integer", minimum: 1, maximum: MAX_PHOTO_CONTENT_LENGTH_BYTES },
    },
    additionalProperties: false,
  },

  presignPhotoResponse: {
    type: "object",
    required: ["uploadUrl", "s3Key", "expiresIn"],
    properties: {
      uploadUrl: { type: "string" },
      s3Key: { type: "string" },
      expiresIn: { type: "integer" },
    },
  },

  confirmPhotoBody: {
    type: "object",
    required: ["s3Key", "stage"],
    properties: {
      s3Key: { type: "string" },
      stage: { type: "string", enum: PHOTO_STAGE_VALUES },
    },
    additionalProperties: false,
  },

  confirmPhotoResponse: {
    type: "object",
    required: ["id", "stage", "createdAt"],
    properties: {
      id: { type: "string" },
      stage: { type: "string", enum: PHOTO_STAGE_VALUES },
      createdAt: { type: "string", format: "date-time" },
    },
  },

  listPhotosResponse: {
    type: "array",
    items: {
      type: "object",
      required: ["id", "stage", "url", "expiresIn", "createdAt"],
      properties: {
        id: { type: "string" },
        stage: { type: "string", enum: PHOTO_STAGE_VALUES },
        url: { type: "string" },
        expiresIn: { type: "integer" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
  },

  // MOVO-196 (AC6): `stage: null` cuando el envío no tiene handshake pendiente --
  // `satisfied`/`photoCount` igual viajan (`true`/`0`), no hay nada que exigir.
  evidenceStatusResponse: {
    type: "object",
    required: ["stage", "satisfied", "photoCount", "minRequired", "maxAllowed"],
    properties: {
      stage: { type: ["string", "null"], enum: [...EVIDENCE_PHOTO_STAGE_VALUES, null] },
      satisfied: { type: "boolean" },
      photoCount: { type: "integer" },
      minRequired: { type: "integer" },
      maxAllowed: { type: "integer" },
    },
  },

  shipmentEventResponse,

  shipmentEventsResponse: {
    type: "array",
    items: shipmentEventResponse,
  },

  offerResponse,

  listShipmentOffersQuery: {
    type: "object",
    properties: {
      sort: { type: "string", enum: OFFER_SORT_VALUES, default: "price" },
      includeResolved: { type: "boolean", default: false },
    },
  },

  listShipmentOffersResponse: {
    type: "array",
    items: offerResponse,
  },

  /**
   * MOVO-143 (AC1/AC6): `priceOfferedArs` es el NETO que el transportista quiere
   * cobrar -- el servidor calcula el bruto, nunca al revés. Nombre de campo tal
   * como lo fija el AC1 del ticket, aunque semánticamente sea "neto ingresado" y no
   * el precio final ofertado (ver `createOfferResponse.priceNetArs` para el mismo
   * valor sin ambigüedad).
   */
  createOfferBody: {
    type: "object",
    required: ["priceOfferedArs", "offeredDate"],
    properties: {
      priceOfferedArs: { type: "number", exclusiveMinimum: 0 },
      offeredDate: { type: "string", format: "date" },
      // MOVO-177: solo cuando el transportista propone un día/horario de retiro
      // distinto al pedido por el emisor -- both o ninguno (validado en el servicio,
      // AJV no expresa bien una dependencia condicional de a pares acá).
      offeredPickupTimeWindowStart: { type: "string", pattern: TIME_PATTERN },
      offeredPickupTimeWindowEnd: { type: "string", pattern: TIME_PATTERN },
      message: { type: "string", maxLength: 500 },
      // MOVO-162: viaje declarado (activo, propio) del que esta oferta forma parte.
      tripId: { type: "string", format: "uuid" },
      // MOVO-180: entrega estimada (día + franja) -- opcional, both-or-neither
      // validado en shipments.service.ts (AJV no expresa esa condición limpio sin
      // dependentRequired/if-then, mismo criterio que originLat/destinationLat en
      // listAvailableQuery).
      estimatedDeliveryDate: { type: "string", format: "date" },
      estimatedDeliveryTimeWindowStart: { type: "string", pattern: TIME_PATTERN },
      estimatedDeliveryTimeWindowEnd: { type: "string", pattern: TIME_PATTERN },
    },
    additionalProperties: false,
  },

  createOfferResponse,

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

  // MOVO-206: ruta optimizada del transportista
  myRouteQuery: {
    type: "object",
    required: ["lat", "lng"],
    properties: {
      lat: { type: "number", minimum: -90, maximum: 90 },
      lng: { type: "number", minimum: -180, maximum: 180 },
    },
  },

  myRouteResponse: {
    type: "object",
    required: ["stops", "totalDistanceKm", "totalDurationMinutes", "optimized", "disclaimer"],
    properties: {
      stops: {
        type: "array",
        items: {
          type: "object",
          required: [
            "stopOrder",
            "shipmentId",
            "type",
            "lat",
            "lng",
            "estimatedArrivalMinutes",
            "outsideTimeWindow",
          ],
          properties: {
            stopOrder: { type: "integer" },
            shipmentId: { type: "string", format: "uuid" },
            type: { type: "string", enum: ["pickup", "delivery"] },
            address: { type: ["string", "null"] },
            lat: { type: "number" },
            lng: { type: "number" },
            estimatedArrivalMinutes: { type: "number" },
            estimatedArrivalAt: { type: ["string", "null"] },
            estimatedDepartureAt: { type: ["string", "null"] },
            timeWindowStart: { type: ["string", "null"] },
            timeWindowEnd: { type: ["string", "null"] },
            outsideTimeWindow: { type: "boolean" },
          },
        },
      },
      totalDistanceKm: { type: "number" },
      totalDurationMinutes: { type: "number" },
      optimized: { type: "boolean" },
      disclaimer: { type: ["string", "null"] },
    },
  },
};
