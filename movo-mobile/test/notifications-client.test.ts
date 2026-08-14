describe("notificationsClient", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("registerPushToken hace POST /users/me/push-token con el payload", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: { post: jest.fn().mockResolvedValue(undefined), delete: jest.fn() },
    }));
    const { notificationsClient } = require("../src/api/notifications-client");
    const { httpClient } = require("../src/api/http-client");

    await notificationsClient.registerPushToken({
      expoPushToken: "ExponentPushToken[abc]",
      deviceId: "device-1",
      platform: "ios",
    });

    expect(httpClient.post).toHaveBeenCalledWith("/users/me/push-token", {
      expoPushToken: "ExponentPushToken[abc]",
      deviceId: "device-1",
      platform: "ios",
    });
  });

  it("unregisterPushToken hace DELETE /users/me/push-token con el deviceId", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: { post: jest.fn(), delete: jest.fn().mockResolvedValue(undefined) },
    }));
    const { notificationsClient } = require("../src/api/notifications-client");
    const { httpClient } = require("../src/api/http-client");

    await notificationsClient.unregisterPushToken("device-1");

    expect(httpClient.delete).toHaveBeenCalledWith("/users/me/push-token", {
      deviceId: "device-1",
    });
  });
});
