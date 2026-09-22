import { NotificationTriggerKey, notificationTriggerCategory, renderNotificationTrigger } from "@movo/shared";
import { NotificationsClient } from "../adapters/notifications-client";

type DispatchPushLogger = { warn: (obj: unknown, msg?: string) => void } | undefined;

/**
 * Colapsa el patrón repetido en `handshake.service.ts` (retiro/entrega) y
 * `trips.service.ts#dispatchTripStartedPushes` (inicio de viaje): resolver copy +
 * categoría de un trigger, mandarlo con `notificationsClient.sendPush`, y tragarse
 * cualquier error con un `logger?.warn` propio -- best-effort, nunca debe rechazar ni
 * bloquear al caller. Un `sendCustodyPush` que falla nunca tira: siempre resuelve.
 */
export async function sendCustodyPush<K extends NotificationTriggerKey>(params: {
  notificationsClient: NotificationsClient;
  userId: string;
  triggerKey: K;
  params: Parameters<typeof renderNotificationTrigger<K>>[1];
  data: Record<string, unknown>;
  logger?: DispatchPushLogger;
  /** Mensaje de warn + campos extra para el log si el envío falla -- distingue en las
   * métricas "no se pudo notificar al emisor" de "...al receptor/transportista". */
  onErrorContext: { event: string; message: string; extra?: Record<string, unknown> };
}): Promise<void> {
  const copy = renderNotificationTrigger(params.triggerKey, params.params);
  try {
    await params.notificationsClient.sendPush({
      userId: params.userId,
      title: copy.title,
      body: copy.body,
      category: notificationTriggerCategory(params.triggerKey),
      data: params.data,
    });
  } catch (err) {
    params.logger?.warn(
      { err, event: params.onErrorContext.event, userId: params.userId, ...params.onErrorContext.extra },
      params.onErrorContext.message
    );
  }
}
