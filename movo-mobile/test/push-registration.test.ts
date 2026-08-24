jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue("device-1"),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: "test-project-id" } } } },
}));

jest.mock("expo-notifications", () => ({
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

jest.mock("../src/api/notifications-client", () => ({
  notificationsClient: {
    registerPushToken: jest.fn().mockResolvedValue(undefined),
    unregisterPushToken: jest.fn().mockResolvedValue(undefined),
  },
}));

describe("push-registration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const SecureStore = require("expo-secure-store");
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("device-1");
  });

  describe("requestPermissionAndRegisterPushToken", () => {
    it("AC1: si el permiso se deniega, no registra nada", async () => {
      const Notifications = require("expo-notifications");
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: "denied" });
      const { notificationsClient } = require("../src/api/notifications-client");

      const { requestPermissionAndRegisterPushToken } = require("../src/lib/push-registration");
      await expect(requestPermissionAndRegisterPushToken()).resolves.toBeUndefined();

      expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
      expect(notificationsClient.registerPushToken).not.toHaveBeenCalled();
    });

    it("AC2/AC3: con permiso concedido, obtiene el token y lo registra", async () => {
      const Notifications = require("expo-notifications");
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: "granted" });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        data: "ExponentPushToken[abc]",
      });
      const { notificationsClient } = require("../src/api/notifications-client");

      const { requestPermissionAndRegisterPushToken } = require("../src/lib/push-registration");
      await requestPermissionAndRegisterPushToken();

      expect(notificationsClient.registerPushToken).toHaveBeenCalledWith({
        expoPushToken: "ExponentPushToken[abc]",
        deviceId: "device-1",
        platform: expect.stringMatching(/^(ios|android)$/),
      });
    });

    it("AC7: si getExpoPushTokenAsync tira (Expo Go / sin projectId), no rompe y no registra", async () => {
      const Notifications = require("expo-notifications");
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: "granted" });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValue(
        new Error("Expo Go no soporta push"),
      );
      const { notificationsClient } = require("../src/api/notifications-client");

      const { requestPermissionAndRegisterPushToken } = require("../src/lib/push-registration");
      await expect(requestPermissionAndRegisterPushToken()).resolves.toBeUndefined();

      expect(notificationsClient.registerPushToken).not.toHaveBeenCalled();
    });

    it("no rompe si requestPermissionsAsync tira", async () => {
      const Notifications = require("expo-notifications");
      (Notifications.requestPermissionsAsync as jest.Mock).mockRejectedValue(new Error("boom"));

      const { requestPermissionAndRegisterPushToken } = require("../src/lib/push-registration");
      await expect(requestPermissionAndRegisterPushToken()).resolves.toBeUndefined();
    });

    it("no rompe si el registro contra el backend falla", async () => {
      const Notifications = require("expo-notifications");
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: "granted" });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        data: "ExponentPushToken[abc]",
      });
      const { notificationsClient } = require("../src/api/notifications-client");
      (notificationsClient.registerPushToken as jest.Mock).mockRejectedValue(new Error("network"));

      const { requestPermissionAndRegisterPushToken } = require("../src/lib/push-registration");
      await expect(requestPermissionAndRegisterPushToken()).resolves.toBeUndefined();
    });
  });

  describe("unregisterCurrentDevice", () => {
    it("AC4: llama a unregisterPushToken con el deviceId persistido", async () => {
      const { notificationsClient } = require("../src/api/notifications-client");

      const { unregisterCurrentDevice } = require("../src/lib/push-registration");
      await unregisterCurrentDevice();

      expect(notificationsClient.unregisterPushToken).toHaveBeenCalledWith("device-1");
    });

    it("tolera que la llamada falle, sin lanzar", async () => {
      const { notificationsClient } = require("../src/api/notifications-client");
      (notificationsClient.unregisterPushToken as jest.Mock).mockRejectedValue(new Error("network"));

      const { unregisterCurrentDevice } = require("../src/lib/push-registration");
      await expect(unregisterCurrentDevice()).resolves.toBeUndefined();
    });
  });
});
