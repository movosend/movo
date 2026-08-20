import { vi } from "vitest";
import { NotificationsClient, SendPushInput } from "../src/adapters/notifications-client";

/**
 * Fake de `NotificationsClient` para tests — evita depender de un `movo-svc-users`
 * real levantado (mismo criterio que `fake-users-client.ts`). Por default nunca
 * rechaza, igual que la implementación real (best-effort, AC5 de MOVO-108); pasar
 * `sendPush` en `overrides` para simular un fallo y verificar que el caller no se
 * rompe igual.
 */
export function createFakeNotificationsClient(overrides: Partial<NotificationsClient> = {}): NotificationsClient {
  return {
    sendPush: vi.fn(async (_input: SendPushInput) => {}),
    ...overrides,
  };
}
