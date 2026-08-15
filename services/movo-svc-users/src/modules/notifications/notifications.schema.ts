// Autocontenido a propósito, mismo criterio que el resto de los módulos.
export const notificationsSchemas = {
  internalPushBody: {
    type: "object",
    required: ["userId", "title", "body"],
    properties: {
      userId: { type: "string", format: "uuid" },
      title: { type: "string", minLength: 1 },
      body: { type: "string", minLength: 1 },
      // Payload libre para el caller (ej. `{type: "shipment", shipmentId}`, MOVO-107
      // AC6) — este servicio no interpreta su contenido, solo lo reenvía al provider.
      data: { type: "object", additionalProperties: true },
    },
  },
};
