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

  // Solo el conteo, nunca los ids (decisión de privacidad de MOVO-174).
  mutualConnectionsResponse: {
    type: "object",
    required: ["totalCount"],
    properties: {
      totalCount: { type: "integer" },
    },
  },
};
