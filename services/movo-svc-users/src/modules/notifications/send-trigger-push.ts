import { FastifyBaseLogger } from "fastify";
import { NotificationTriggerKey, notificationTriggerCategory, renderNotificationTrigger } from "@movo/shared";
import { createNotificationsService } from "./notifications.service";

/** Lo único que un flujo de negocio necesita del módulo de notificaciones — el tipo
 * se deriva del service real para que no pueda divergir de su firma. */
export type PushSender = Pick<ReturnType<typeof createNotificationsService>, "sendPushToUser">;

/**
 * MOVO-274: resuelve copy + categoría de un trigger de `@movo/shared`, lo manda con
 * `sendPushToUser` y se traga cualquier error con un `logger.warn` propio — best-effort,
 * nunca rechaza ni bloquea al caller. Es el equivalente en este servicio de
 * `sendCustodyPush` de `movo-svc-shipments`: un push que falla (proveedor caído, error
 * al resolver preferencias) no puede hacer fallar el webhook o el cambio de credenciales
 * que ya quedó persistido.
 */
export async function sendTriggerPush<K extends NotificationTriggerKey>(params: {
  notifications: PushSender;
  userId: string;
  triggerKey: K;
  params: Parameters<typeof renderNotificationTrigger<K>>[1];
  data: Record<string, unknown>;
  logger: FastifyBaseLogger;
  /** Evento + mensaje del warn si el envío falla, y campos extra para el log — distingue
   * en las métricas "no se pudo avisar el resultado de KYC" de "...el cambio de contraseña". */
  onErrorContext: { event: string; message: string; extra?: Record<string, unknown> };
}): Promise<void> {
  try {
    const { title, body } = renderNotificationTrigger(params.triggerKey, params.params);
    await params.notifications.sendPushToUser(params.userId, {
      title,
      body,
      category: notificationTriggerCategory(params.triggerKey),
      data: params.data,
    });
  } catch (err) {
    params.logger.warn(
      { err, event: params.onErrorContext.event, userId: params.userId, ...params.onErrorContext.extra },
      params.onErrorContext.message
    );
  }
}
