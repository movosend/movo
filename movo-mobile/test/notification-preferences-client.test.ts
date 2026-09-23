describe("notificationPreferencesClient", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("getPreferences hace GET /users/me/notification-preferences", async () => {
    const response = {
      pushEnabled: true,
      quietHours: { enabled: false, from: "23:00", to: "08:00" },
      categories: [{ id: "custody", enabled: true }],
    };
    jest.doMock("../src/api/http-client", () => ({
      httpClient: { get: jest.fn().mockResolvedValue(response) },
    }));
    const { notificationPreferencesClient } = require("../src/api/notification-preferences-client");
    const { httpClient } = require("../src/api/http-client");

    const res = await notificationPreferencesClient.getPreferences();

    expect(httpClient.get).toHaveBeenCalledWith("/users/me/notification-preferences");
    expect(res).toEqual(response);
  });

  it("updatePreferences hace PUT /users/me/notification-preferences con el body dado", async () => {
    const response = {
      pushEnabled: false,
      quietHours: { enabled: true, from: "23:00", to: "08:00" },
      categories: [{ id: "custody", enabled: false }],
    };
    jest.doMock("../src/api/http-client", () => ({
      httpClient: { put: jest.fn().mockResolvedValue(response) },
    }));
    const { notificationPreferencesClient } = require("../src/api/notification-preferences-client");
    const { httpClient } = require("../src/api/http-client");

    const res = await notificationPreferencesClient.updatePreferences({ pushEnabled: false });

    expect(httpClient.put).toHaveBeenCalledWith("/users/me/notification-preferences", { pushEnabled: false });
    expect(res).toEqual(response);
  });
});
