/**
 * MOVO-268: schema laxo a propósito. El body de MP trae más campos de los que se usan y
 * puede cambiar sin aviso; un 400 por un campo nuevo haría que MP reintente para siempre.
 * Lo único que importa (la firma y el id del pago) se valida en la ruta.
 */
export const mpWebhookSchema = {
  tags: ["webhooks"],
  summary: "Notificaciones de Mercado Pago (tópico payment)",
  description:
    "Pública en el gateway; protegida por la firma x-signature. Responde 200 apenas guarda la notificación y la procesa después.",
  querystring: {
    type: "object",
    additionalProperties: true,
    properties: {
      "data.id": { type: "string" },
      type: { type: "string" },
    },
  },
  body: {
    type: "object",
    additionalProperties: true,
  },
  response: {
    200: {
      type: "object",
      properties: { received: { type: "boolean" } },
    },
  },
} as const;
