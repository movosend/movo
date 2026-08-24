export const geocodeSchemas = {
  geocodeBody: {
    type: "object",
    additionalProperties: false,
    required: ["street", "number", "city", "province", "zip"],
    properties: {
      street: { type: "string" },
      number: { type: "string" },
      floor: { type: "string" },
      city: { type: "string" },
      province: { type: "string" },
      zip: { type: "string" },
    },
  },
  geocodeResponse: {
    type: "object",
    required: ["lat", "long", "formattedAddress"],
    properties: {
      lat: { type: "number" },
      long: { type: "number" },
      formattedAddress: { type: "string" },
    },
  },
  reverseGeocodeBody: {
    type: "object",
    additionalProperties: false,
    required: ["lat", "long"],
    properties: {
      lat: { type: "number", minimum: -90, maximum: 90 },
      long: { type: "number", minimum: -180, maximum: 180 },
    },
  },
  reverseGeocodeResponse: {
    type: "object",
    required: ["formattedAddress"],
    properties: {
      formattedAddress: { type: "string" },
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
