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
      },
    },
    requestId: { type: "string" },
  },
};

export const placesSchemas = {
  autocompleteBody: {
    type: "object",
    additionalProperties: false,
    required: ["input"],
    properties: {
      input: { type: "string", minLength: 2 },
    },
  },
  autocompleteResponse: {
    type: "object",
    required: ["predictions"],
    properties: {
      predictions: {
        type: "array",
        items: {
          type: "object",
          required: ["placeId", "description"],
          properties: {
            placeId: { type: "string" },
            description: { type: "string" },
          },
        },
      },
    },
  },

  detailsBody: {
    type: "object",
    additionalProperties: false,
    required: ["placeId"],
    properties: {
      placeId: { type: "string", minLength: 1 },
    },
  },
  detailsResponse: {
    type: "object",
    required: ["formattedAddress", "lat", "long"],
    properties: {
      formattedAddress: { type: "string" },
      lat: { type: "number" },
      long: { type: "number" },
    },
  },

  errorResponse,
};
