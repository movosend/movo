import { PushNotificationProvider } from "./push-notification-provider";

export interface SentPushNotification {
  expoPushToken: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** `PushNotificationProvider` de más superficie que la interfaz real -- expone los
 * envíos capturados en memoria para que los tests de integración puedan aseverar
 * contra ellos sin depender de red (mismo criterio que `MockStorageProvider`/
 * `SmsProvider` capturado en los tests de OTP). */
export interface MockPushProvider extends PushNotificationProvider {
  __sentNotifications: SentPushNotification[];
}

/** Implementación de desarrollo (PUSH_PROVIDER=mock, default): sin red, guarda el
 * envío en memoria -- mismo criterio que `MockDiditClient`/`ConsoleSmsProvider`/
 * `MockGeocodingProvider`/`MockStorageProvider`. */
export function createMockPushProvider(): MockPushProvider {
  const sentNotifications: SentPushNotification[] = [];

  return {
    __sentNotifications: sentNotifications,

    async send(input): Promise<void> {
      sentNotifications.push({
        expoPushToken: input.expoPushToken,
        title: input.title,
        body: input.body,
        ...(input.data !== undefined ? { data: input.data } : {}),
      });
    },
  };
}
