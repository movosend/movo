import { vi } from "vitest";
import { NotificationsClient } from "../src/adapters/notifications-client";

export function createFakeNotificationsClient(overrides: Partial<NotificationsClient> = {}): NotificationsClient {
  return {
    sendPush: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
