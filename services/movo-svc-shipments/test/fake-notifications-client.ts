import { vi } from "vitest";
import { NotificationsClient, SendPushNotificationInput } from "../src/adapters/notifications-client";

/**
 * Fake de `NotificationsClient` para tests — evita depender de un `movo-svc-users`
 * real levantado (mismo criterio que `fake-users-client.ts`). Por default resuelve
 * sin rechazar; pasar `sendPush` en `overrides` para simular un fallo y verificar que
 * el caller lo trata como best-effort (AC5 de MOVO-108 / AC9 de MOVO-129).
 */
export function createFakeNotificationsClient(overrides: Partial<NotificationsClient> = {}): NotificationsClient {
  return {
    sendPush: vi.fn(async (_input: SendPushNotificationInput) => {}),
    ...overrides,
  };
}
