import { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";
import { verifyMpWebhookSignature } from "../../utils/mp-webhook-signature";
import { mpWebhookSchema } from "./mp-webhook.schema";

interface MpWebhookBody {
  id?: string | number;
  type?: string;
  action?: string;
  user_id?: string | number;
  live_mode?: boolean;
  data?: { id?: string | number };
}

interface MpWebhookQuery {
  "data.id"?: string;
  type?: string;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * MOVO-268: `POST /payments/webhooks/mercadopago`, registrado en el panel de la app de MP
 * para el tópico `payment`. Pública en el gateway (MP no tiene JWT): la protege la firma
 * `x-signature` (AC2). Vive fuera de `paymentsRoutes` para no pasar por su hook de
 * `x-user-id`, igual que el callback de OAuth.
 *
 * Responde 200 apenas la notificación queda guardada (AC7): el procesamiento corre después
 * y un error propio nunca vuelve como 5xx, así MP no reintenta indefinidamente.
 */
export default async function mpWebhookRoutes(app: FastifyInstance) {
  app.post("/mercadopago", { schema: mpWebhookSchema }, async (request, reply) => {
    const secret = app.config.MP_WEBHOOK_SECRET;
    if (!secret) {
      request.log.error("llegó una notificación de MP sin MP_WEBHOOK_SECRET configurada: se rechaza");
      throw new ApiError(503, "PAYMENT_WEBHOOK_NOT_CONFIGURED", "El webhook de Mercado Pago no está configurado");
    }

    const body = (request.body ?? {}) as MpWebhookBody;
    const query = request.query as MpWebhookQuery;
    // MP firma el `data.id` del query string; el del body es el mismo valor.
    const mpPaymentId = asString(query["data.id"]) ?? asString(body.data?.id);

    const valid = verifyMpWebhookSignature({
      signatureHeader: header(request, "x-signature"),
      requestId: header(request, "x-request-id"),
      dataId: mpPaymentId,
      secret,
    });
    if (!valid) {
      request.log.warn({ mpPaymentId }, "notificación de MP con firma inválida");
      throw new ApiError(401, "PAYMENT_WEBHOOK_INVALID_SIGNATURE", "Firma de la notificación inválida");
    }

    const topic = body.type ?? query.type ?? "unknown";
    const mpNotificationId = asString(body.id) ?? header(request, "x-request-id");
    if (!mpPaymentId || !mpNotificationId) {
      request.log.warn({ topic }, "notificación de MP sin id de pago o de notificación: se ignora");
      return reply.code(200).send({ received: true });
    }

    const result = await app.mpWebhooks.receive({
      mpNotificationId,
      topic,
      action: body.action ?? null,
      mpPaymentId,
      mpUserId: asString(body.user_id) ?? null,
      liveMode: typeof body.live_mode === "boolean" ? body.live_mode : null,
    });
    request.log.info(
      { topic, action: body.action, mpPaymentId, stored: result.stored, notificationId: result.notificationId },
      "notificación de MP recibida"
    );
    return reply.code(200).send({ received: true });
  });
}
