export interface SendPushNotificationInput {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Cliente para el envío interno de push notifications hacia `movo-svc-users`
 * (`POST /notifications/push`).
 */
export interface NotificationsClient {
  sendPush(input: SendPushNotificationInput): Promise<void>;
}

export interface NotificationsClientConfig {
  USERS_SERVICE_URL: string;
}

const REQUEST_TIMEOUT_MS = 5000;

export function createNotificationsClient(config: NotificationsClientConfig): NotificationsClient {
  return {
    async sendPush(input: SendPushNotificationInput): Promise<void> {
      const response = await fetch(`${config.USERS_SERVICE_URL}/notifications/push`, {
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
