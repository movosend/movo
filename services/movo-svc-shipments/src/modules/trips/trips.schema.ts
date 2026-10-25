// MOVO-221: `declared` agregado como estado inicial real del ciclo de vida.
// MOVO-260: `expired` separado de `cancelled`.
const TRIP_STATUS_VALUES = ["declared", "active", "cancelled", "expired", "completed"];

const tripResponse = {
  type: "object",
  required: [
    "id",
    "carrierId",
    "originAddress",
    "originLat",
    "originLng",
    "destinationAddress",
    "destinationLat",
    "destinationLng",
    "departureAt",
    "vehicleType",
    "status",
    "recurrenceWeekdays",
    "recurrenceUntil",
    "seriesId",
    "generatedFromTripId",
    "isSeriesHead",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    carrierId: { type: "string" },
    originAddress: { type: "string" },
    originLat: { type: "number" },
    originLng: { type: "number" },
    destinationAddress: { type: "string" },
    destinationLat: { type: "number" },
    destinationLng: { type: "number" },
    departureAt: { type: "string", format: "date-time" },
    vehicleType: { type: "string" },
    status: { type: "string", enum: TRIP_STATUS_VALUES },
    cancelledAt: { type: ["string", "null"], format: "date-time" },
    // MOVO-265 (ADR-042): recurrencia. 0 = domingo … 6 = sábado; null = no se repite.
    recurrenceWeekdays: { type: ["array", "null"], items: { type: "integer" } },
    recurrenceUntil: {
      type: ["string", "null"],
      format: "date",
      description: "Último día de la serie, inclusive, calendario argentino.",
    },
    seriesId: { type: ["string", "null"] },
    generatedFromTripId: { type: ["string", "null"] },
    isSeriesHead: {
      type: "boolean",
      description: "Trip vigente de su serie (sin sucesor). Solo el vigente admite editar la recurrencia.",
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

// MOVO-265: días de la semana de la recurrencia (al menos uno, sin repetidos, 0-6). El día
// de `departureAt` incluido y `recurrenceUntil` posterior a la salida los valida el service.
const recurrenceWeekdaysBody = {
  type: "array",
  items: { type: "integer", minimum: 0, maximum: 6 },
  minItems: 1,
  maxItems: 7,
  uniqueItems: true,
  description: "Días en que se repite el viaje: 0 = domingo … 6 = sábado.",
};
const recurrenceUntilBody = {
  type: "string",
  format: "date",
  description: "Último día de la serie (YYYY-MM-DD, inclusive, calendario argentino).",
};

const tripAcceptedPackageResponse = {
  type: "object",
  required: [
    "shipmentId",
    "status",
    "packageType",
    "weightKg",
    "pickupAddress",
    "pickupLat",
    "pickupLng",
    "deliveryAddress",
    "deliveryLat",
    "deliveryLng",
    "pickupDate",
    "pickupTimeWindowStart",
    "pickupTimeWindowEnd",
    "agreedPriceArs",
    "senderId",
    "senderName",
    "senderPhotoUrl",
  ],
  properties: {
    shipmentId: { type: "string" },
    status: { type: "string" },
    packageType: { type: "string" },
    weightKg: { type: "number" },
    pickupAddress: { type: "string" },
    pickupLat: { type: "number" },
    pickupLng: { type: "number" },
    deliveryAddress: { type: "string" },
    deliveryLat: { type: "number" },
    deliveryLng: { type: "number" },
    pickupDate: { type: "string" },
    pickupTimeWindowStart: { type: "string" },
    pickupTimeWindowEnd: { type: "string" },
    agreedPriceArs: { type: "number" },
    senderId: { type: "string" },
    senderName: { type: "string" },
    senderPhotoUrl: { type: ["string", "null"] },
  },
};

const tripWithAcceptedPackagesResponse = {
  type: "object",
  required: [...tripResponse.required, "hasAcceptedPackages", "acceptedPackagesCount", "executablePackagesCount"],
  properties: {
    ...tripResponse.properties,
    hasAcceptedPackages: { type: "boolean" },
    acceptedPackagesCount: { type: "integer" },
    executablePackagesCount: {
      type: "integer",
      description:
        "Paquetes aceptados que el viaje ya puede ejecutar (envío assigned o in_transit). POST /trips/:id/start exige al menos uno.",
    },
    packages: { type: "array", items: tripAcceptedPackageResponse },
  },
};

const availableShipmentResponse = {
  type: "object",
  required: [
    "id",
    "packageType",
    "weightKg",
    "lengthCm",
    "widthCm",
    "heightCm",
    "oversized",
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
    "status",
    "createdAt",
    "distanceKm",
    "pickupDistanceKm",
    "deliveryDistanceKm",
    "hasMyOffer",
    "debtDiscount",
    "detourDistanceKm",
    "detourDurationMinutes",
  ],
  properties: {
    id: { type: "string" },
    packageType: { type: "string" },
    weightKg: { type: "number" },
    lengthCm: { type: "number" },
    widthCm: { type: "number" },
    heightCm: { type: "number" },
    oversized: { type: "boolean" },
    description: { type: ["string", "null"] },
    urgent: { type: "boolean" },
    pickupAddress: { type: "string" },
    pickupLat: { type: "number" },
    pickupLng: { type: "number" },
    deliveryAddress: { type: "string" },
    deliveryLat: { type: "number" },
    deliveryLng: { type: "number" },
    pickupDate: { type: "string" },
    pickupTimeWindowStart: { type: "string" },
    pickupTimeWindowEnd: { type: "string" },
    suggestedPriceArs: { type: ["number", "null"] },
    status: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    distanceKm: { type: "number" },
    pickupDistanceKm: { type: "number" },
    deliveryDistanceKm: { type: ["number", "null"] },
    hasMyOffer: { type: "boolean" },
    debtDiscount: { type: ["object", "null"], required: ["amountArs", "reason"], properties: {
      amountArs: { type: "number" }, reason: { type: "string", enum: ["pending_balance"] },
    } },
    detourDistanceKm: { type: "number" },
    detourDurationMinutes: { type: "integer" },
  },
};

export const tripsSchemas = {
  createTripBody: {
    type: "object",
    required: [
      "originAddress",
      "originLat",
      "originLng",
      "destinationAddress",
      "destinationLat",
      "destinationLng",
      "departureAt",
      "vehicleType",
    ],
    additionalProperties: false,
    properties: {
      originAddress: { type: "string", minLength: 1 },
      originLat: { type: "number", minimum: -90, maximum: 90 },
      originLng: { type: "number", minimum: -180, maximum: 180 },
      destinationAddress: { type: "string", minLength: 1 },
      destinationLat: { type: "number", minimum: -90, maximum: 90 },
      destinationLng: { type: "number", minimum: -180, maximum: 180 },
      departureAt: { type: "string", format: "date-time" },
      vehicleType: { type: "string", minLength: 1, maxLength: 50 },
      recurrenceWeekdays: recurrenceWeekdaysBody,
      recurrenceUntil: recurrenceUntilBody,
    },
  },

  updateTripBody: {
    type: "object",
    additionalProperties: false,
    properties: {
      originAddress: { type: "string", minLength: 1 },
      originLat: { type: "number", minimum: -90, maximum: 90 },
      originLng: { type: "number", minimum: -180, maximum: 180 },
      destinationAddress: { type: "string", minLength: 1 },
      destinationLat: { type: "number", minimum: -90, maximum: 90 },
      destinationLng: { type: "number", minimum: -180, maximum: 180 },
      departureAt: { type: "string", format: "date-time" },
      vehicleType: { type: "string", minLength: 1, maxLength: 50 },
      // `null` apaga la recurrencia (y limpia `recurrenceUntil`).
      recurrenceWeekdays: { ...recurrenceWeekdaysBody, type: ["array", "null"] },
      recurrenceUntil: { ...recurrenceUntilBody, type: ["string", "null"] },
    },
  },

  // MOVO-265: body opcional de `POST /trips/:id/cancel`.
  cancelTripBody: {
    type: "object",
    nullable: true,
    additionalProperties: false,
    properties: {
      stopRecurrence: {
        type: "boolean",
        description: "Además de cancelar esta ocurrencia, deja de repetir el viaje. Se ignora si no es recurrente.",
      },
    },
  },

  listTripsQuery: {
    type: "object",
    properties: {
      status: { type: "string", enum: TRIP_STATUS_VALUES },
      scope: {
        type: "string",
        enum: ["upcoming", "history"],
        description:
          "Excluyente con `status` (400 si llegan los dos). `upcoming`: declared+active, por departureAt asc " +
          "-- incluye un declared con departureAt ya vencido hasta que el barrido lo expire (hasta 15 min), " +
          "o indefinidamente si tiene paquetes aceptados (el transportista todavía tiene que iniciarlo). " +
          "`history`: completed+cancelled+expired, por departureAt desc.",
      },
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    },
  },

  matchesQuery: {
    type: "object",
    properties: {
      radiusKm: { type: "number", minimum: 1, maximum: 500 },
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    },
  },

  tripIdParam: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
    },
  },

  tripResponse,
  tripWithAcceptedPackagesResponse,

  listTripsResponse: {
    type: "object",
    required: ["items", "page", "limit", "total"],
    properties: {
      items: { type: "array", items: tripWithAcceptedPackagesResponse },
      page: { type: "integer" },
      limit: { type: "integer" },
      total: { type: "integer" },
    },
  },

  matchesResponse: {
    type: "object",
    required: ["items", "page", "limit", "total", "tripId", "radiusKm"],
    properties: {
      items: { type: "array", items: availableShipmentResponse },
      page: { type: "integer" },
      limit: { type: "integer" },
      total: { type: "integer" },
      tripId: { type: "string" },
      radiusKm: { type: "number" },
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
          // MOVO-116: datos extra opcionales del error (ej. `missingRequirements` del bloqueo
          // del transportista). Sin declararlo, fast-json-stringify lo descarta en silencio.
          details: { type: "object", additionalProperties: true },
        },
      },
      requestId: { type: "string" },
    },
  },
};
