import { SECURE_STORE_KEYS } from "../src/lib/secure-store";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/api/auth-client", () => ({
  authClient: {
    refresh: jest.fn(),
    logout: jest.fn(),
  },
}));

const SESSION_USER = {
  userId: "usr_1",
  fullName: "Julia Pérez",
  roles: ["sender"],
  kycStatus: "approved",
};

const REFRESHED_SESSION = {
  userId: "usr_1",
  accessToken: "access_2",
  refreshToken: "refresh_2",
  expiresIn: 3600,
  kycStatus: "approved",
  fullName: "Julia Pérez",
  roles: ["sender"],
};

describe("auth-store", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    const SecureStore = require("expo-secure-store");
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  it("restoreSession termina 'unauthenticated' si no hay nada guardado", async () => {
    const { useAuthStore } = require("../src/store/auth-store");

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  it("restoreSession con tokens vigentes queda 'authenticated' sin llamar a refresh (AC7)", async () => {
    const SecureStore = require("expo-secure-store");
    const futureExpiry = Date.now() + 10 * 60 * 1000;
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => {
      switch (key) {
        case SECURE_STORE_KEYS.sessionAccessToken:
          return Promise.resolve("access_1");
        case SECURE_STORE_KEYS.sessionRefreshToken:
          return Promise.resolve("refresh_1");
        case SECURE_STORE_KEYS.sessionUser:
          return Promise.resolve(JSON.stringify(SESSION_USER));
        case SECURE_STORE_KEYS.sessionExpiresAt:
          return Promise.resolve(String(futureExpiry));
        default:
          return Promise.resolve(null);
      }
    });

    const { useAuthStore } = require("../src/store/auth-store");
    const { authClient } = require("../src/api/auth-client");

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().accessToken).toBe("access_1");
    expect(authClient.refresh).not.toHaveBeenCalled();
  });

  it("restoreSession con tokens vencidos refresca en silencio y persiste la sesión nueva (AC6/AC7)", async () => {
    const SecureStore = require("expo-secure-store");
    const pastExpiry = Date.now() - 1000;
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => {
      switch (key) {
        case SECURE_STORE_KEYS.sessionAccessToken:
          return Promise.resolve("access_1");
        case SECURE_STORE_KEYS.sessionRefreshToken:
          return Promise.resolve("refresh_1");
        case SECURE_STORE_KEYS.sessionUser:
          return Promise.resolve(JSON.stringify(SESSION_USER));
        case SECURE_STORE_KEYS.sessionExpiresAt:
          return Promise.resolve(String(pastExpiry));
        default:
          return Promise.resolve(null);
      }
    });

    const { useAuthStore } = require("../src/store/auth-store");
    const { authClient } = require("../src/api/auth-client");
    (authClient.refresh as jest.Mock).mockResolvedValue(REFRESHED_SESSION);

    await useAuthStore.getState().restoreSession();

    expect(authClient.refresh).toHaveBeenCalledWith({ refreshToken: "refresh_1" });
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().accessToken).toBe("access_2");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      SECURE_STORE_KEYS.sessionAccessToken,
      "access_2",
    );
  });

  it("restoreSession limpia todo si el refresh silencioso falla (AC6)", async () => {
    const SecureStore = require("expo-secure-store");
    const pastExpiry = Date.now() - 1000;
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => {
      switch (key) {
        case SECURE_STORE_KEYS.sessionAccessToken:
          return Promise.resolve("access_1");
        case SECURE_STORE_KEYS.sessionRefreshToken:
          return Promise.resolve("refresh_1");
        case SECURE_STORE_KEYS.sessionUser:
          return Promise.resolve(JSON.stringify(SESSION_USER));
        case SECURE_STORE_KEYS.sessionExpiresAt:
          return Promise.resolve(String(pastExpiry));
        default:
          return Promise.resolve(null);
      }
    });

    const { useAuthStore } = require("../src/store/auth-store");
    const { authClient } = require("../src/api/auth-client");
    (authClient.refresh as jest.Mock).mockRejectedValue(new Error("refresh inválido"));

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SECURE_STORE_KEYS.sessionAccessToken);
  });

  it("logout() llama a authClient.logout y limpia la sesión local (AC10)", async () => {
    const { useAuthStore } = require("../src/store/auth-store");
    const { authClient } = require("../src/api/auth-client");
    (authClient.logout as jest.Mock).mockResolvedValue(undefined);

    await useAuthStore.getState().setSession(REFRESHED_SESSION);
    await useAuthStore.getState().logout();

    expect(authClient.logout).toHaveBeenCalledWith("refresh_2", "access_2");
    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("logout() limpia la sesión local aunque la llamada de red falle", async () => {
    const { useAuthStore } = require("../src/store/auth-store");
    const { authClient } = require("../src/api/auth-client");
    (authClient.logout as jest.Mock).mockRejectedValue(new Error("sin conexión"));

    await useAuthStore.getState().setSession(REFRESHED_SESSION);
    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
