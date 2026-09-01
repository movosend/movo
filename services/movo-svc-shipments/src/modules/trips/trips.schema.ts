const TRIP_STATUS_VALUES = ["active", "cancelled", "completed"];

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
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const tripWithAcceptedPackagesResponse = {
  type: "object",
  required: [...tripResponse.required, "hasAcceptedPackages"],
  properties: {
    ...tripResponse.properties,
    hasAcceptedPackages: { type: "boolean" },
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
  ],
  properties: {
    id: { type: "string" },
    packageType: { type: "string" },
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
      status: { type: "string", enum: TRIP_STATUS_VALUES },
    },
  },

  listTripsQuery: {
    type: "object",
    properties: {
      status: { type: "string", enum: TRIP_STATUS_VALUES },
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
        },
      },
      requestId: { type: "string" },
    },
  },
};
