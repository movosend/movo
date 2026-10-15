export const sessionSchemas = {
  response: {
    type: "object",
    required: ["authenticated"],
    properties: { authenticated: { type: "boolean" } },
  },
} as const;
