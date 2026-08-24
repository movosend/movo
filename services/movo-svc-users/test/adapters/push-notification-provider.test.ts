import { describe, it, expect } from "vitest";
import { createPushNotificationProvider } from "../../src/adapters/push-notification-provider";

describe("createPushNotificationProvider (factory, MOVO-106)", () => {
  it("devuelve el MockPushProvider por default (PUSH_PROVIDER=mock)", async () => {
    const provider = createPushNotificationProvider({ PUSH_PROVIDER: "mock" });
    await provider.send({ expoPushToken: "ExponentPushToken[abc]", title: "t", body: "b" });
    expect((provider as unknown as { __sentNotifications: unknown[] }).__sentNotifications).toHaveLength(1);
  });

  it("con PUSH_PROVIDER=expo arma el provider real sin tirar (no requiere credenciales)", () => {
    expect(() => createPushNotificationProvider({ PUSH_PROVIDER: "expo" })).not.toThrow();
  });
});
