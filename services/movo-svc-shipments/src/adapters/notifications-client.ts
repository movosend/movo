import { NotificationCategoryId } from "@movo/shared";

export interface SendPushNotificationInput {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** MOVO-245 (AC1/AC2): obligatoria -- `movo-svc-users` la exige para poder respetar
   * el toggle maestro/de categoría/horario de silencio del usuario antes de enviar.
   * Preferí `notificationTriggerCategory(triggerKey)` (@movo/shared) en vez de
   * escribir el id a mano en cada call site. */
  category: NotificationCategoryId;
}

/**
 * Cliente para el envío interno de push notifications hacia `movo-svc-users`
 * (`POST /internal/notifications/push`).
 */
export interface NotificationsClient {
  sendPush(input: SendPushNotificationInput): Promise<void>;
}

export interface NotificationsClientConfig {
  USERS_SERVICE_URL: string;
}

const REQUEST_TIMEOUT_MS = 5000;
const PUSH_ENDPOINT = "/internal/notifications/push";

export function createNotificationsClient(config: NotificationsClientConfig): NotificationsClient {
  return {
    async sendPush(input: SendPushNotificationInput): Promise<void> {
      const response = await fetch(`${config.USERS_SERVICE_URL}${PUSH_ENDPOINT}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`El servicio de notificaciones devolvió status ${response.status}`);
      }
    },
  };
}
