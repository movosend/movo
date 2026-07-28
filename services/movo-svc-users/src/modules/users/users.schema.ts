export const usersSchemas = {
  usersCountResponse: {
    type: "object",
    properties: {
      count: { type: "integer" },
    },
    required: ["count"],
  },
};
