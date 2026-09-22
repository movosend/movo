// Autocontenido a propósito, mismo criterio que el resto de los módulos.
export const notificationsSchemas = {
  internalPushBody: {
    type: "object",
    required: ["userId", "title", "body", "category"],
    properties: {
      userId: { type: "string", format: "uuid" },
      title: { type: "string", minLength: 1 },
      body: { type: "string", minLength: 1 },
      // Payload libre para el caller (ej. `{type: "shipment", shipmentId}`, MOVO-107
      // AC6) — este servicio no interpreta su contenido, solo lo reenvía al provider.
      data: { type: "object", additionalProperties: true },
      // MOVO-245 (AC1/AC2): obligatoria -- ver el comentario de `SendPushInput.category`
      // en notifications.service.ts. La validación de que sea una categoría conocida
      // vive en el service (`isPushAllowed`), no acá -- una categoría inválida es
      // "no se manda", no un 400 (el caller ya confirmó la operación de negocio del
      // otro lado, ej. crear el envío; el best-effort de la push no debería poder
      // reventar esa respuesta 2xx).
      category: { type: "string", minLength: 1 },
    },
  },
};
