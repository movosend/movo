// Autocontenido a propósito -- mismo criterio que el resto de los *.schema.ts del repo.
export const mutualConnectionsSchemas = {
  // Dos ids de usuario en el path: `userId` es el viewer, `otherId` el perfil visitado.
  usersParam: {
    type: "object",
    required: ["userId", "otherId"],
    properties: {
      userId: { type: "string", format: "uuid" },
      otherId: { type: "string", format: "uuid" },
    },
  },

  // Ids de las contrapartes en común, solo para `movo-svc-users` (interno): él los filtra por
  // estado de cuenta y al cliente le devuelve únicamente el conteo (privacidad de MOVO-174).
  mutualConnectionsResponse: {
    type: "object",
    required: ["counterpartyIds"],
    properties: {
      counterpartyIds: { type: "array", items: { type: "string", format: "uuid" } },
    },
  },
};
