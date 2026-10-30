import { SECURE_STORE_KEYS } from "../src/lib/secure-store";

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: 0,
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

jest.mock("../src/lib/push-registration", () => ({
  unregisterCurrentDevice: jest.fn().mockResolvedValue(undefined),
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
      expect.anything(),
    );
  });

  it("restoreSession limpia la sesión si sessionUser está corrupto en secure-store", async () => {
    const SecureStore = require("expo-secure-store");
    const futureExpiry = Date.now() + 10 * 60 * 1000;
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => {
      switch (key) {
        case SECURE_STORE_KEYS.sessionAccessToken:
          return Promise.resolve("access_1");
        case SECURE_STORE_KEYS.sessionRefreshToken:
          return Promise.resolve("refresh_1");
        case SECURE_STORE_KEYS.sessionUser:
          return Promise.resolve("{not-valid-json");
        case SECURE_STORE_KEYS.sessionExpiresAt:
          return Promise.resolve(String(futureExpiry));
        default:
          return Promise.resolve(null);
      }
    });

    const { useAuthStore } = require("../src/store/auth-store");
    const { authClient } = require("../src/api/auth-client");

    await expect(useAuthStore.getState().restoreSession()).resolves.not.toThrow();

    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(authClient.refresh).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SECURE_STORE_KEYS.sessionAccessToken);
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
    const { ApiError } = require("@movo/shared/dist/errors/api-error");
    (authClient.refresh as jest.Mock).mockRejectedValue(new ApiError(401, "AUTH_REFRESH_INVALID", "Refresh inválido"));

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SECURE_STORE_KEYS.sessionAccessToken);
  });

  it("MOVO-346: restoreSession sin red mantiene la sesión guardada en vez de cerrarla", async () => {
    const SecureStore = require("expo-secure-store");
    const pastExpiry = Date.now() - 1000;
    const stored: Record<string, string> = {
      [SECURE_STORE_KEYS.sessionAccessToken]: "access_1",
      [SECURE_STORE_KEYS.sessionRefreshToken]: "refresh_1",
      [SECURE_STORE_KEYS.sessionUser]: JSON.stringify(SESSION_USER),
      [SECURE_STORE_KEYS.sessionExpiresAt]: String(pastExpiry),
      [SECURE_STORE_KEYS.keychainAccessMigrated]: "1",
    };
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => Promise.resolve(stored[key] ?? null));

    const { useAuthStore } = require("../src/store/auth-store");
    const { authClient } = require("../src/api/auth-client");
    const { ApiError } = require("@movo/shared/dist/errors/api-error");
    (authClient.refresh as jest.Mock).mockRejectedValue(new ApiError(0, "INTERNAL_ERROR", "Sin conexión"));

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState()).toMatchObject({ status: "authenticated", refreshToken: "refresh_1" });
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  describe("MOVO-346: Keychain sin acceso al guardar la sesión", () => {
    it("restoreSession recrea una vez las keys de sesión para que tomen AFTER_FIRST_UNLOCK", async () => {
      const SecureStore = require("expo-secure-store");
      const stored: Record<string, string> = {
        [SECURE_STORE_KEYS.sessionAccessToken]: "access_1",
        [SECURE_STORE_KEYS.sessionRefreshToken]: "refresh_1",
        [SECURE_STORE_KEYS.sessionUser]: JSON.stringify(SESSION_USER),
        [SECURE_STORE_KEYS.sessionExpiresAt]: String(Date.now() + 10 * 60 * 1000),
      };
      (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => Promise.resolve(stored[key] ?? null));
      (SecureStore.setItemAsync as jest.Mock).mockImplementation((key: string, value: string) => {
        stored[key] = value;
        return Promise.resolve();
      });
      const { useAuthStore } = require("../src/store/auth-store");

      await useAuthStore.getState().restoreSession();
      await useAuthStore.getState().restoreSession();

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(4);
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(SECURE_STORE_KEYS.sessionRefreshToken, "refresh_1", {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
      expect(stored[SECURE_STORE_KEYS.keychainAccessMigrated]).toBe("1");
      expect(useAuthStore.getState()).toMatchObject({ status: "authenticated", refreshToken: "refresh_1" });
    });

    it("guarda las keys con AFTER_FIRST_UNLOCK", async () => {
      const SecureStore = require("expo-secure-store");
      const { useAuthStore } = require("../src/store/auth-store");

      await useAuthStore.getState().setSession(REFRESHED_SESSION);

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        SECURE_STORE_KEYS.sessionRefreshToken,
        "refresh_2",
        expect.objectContaining({ keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
      );
    });

    it("si persistir falla, la sesión nueva queda en memoria y se reintenta al volver a primer plano", async () => {
      const SecureStore = require("expo-secure-store");
      const { AppState } = require("react-native");
      const listeners: Array<(state: string) => void> = [];
      jest.spyOn(AppState, "addEventListener").mockImplementation((...args: unknown[]) => {
        listeners.push(args[1] as (state: string) => void);
        return { remove: jest.fn() };
      });
      (SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error("errSecInteractionNotAllowed"));
      const { useAuthStore } = require("../src/store/auth-store");

      await expect(useAuthStore.getState().setSession(REFRESHED_SESSION)).resolves.toBeUndefined();
      expect(useAuthStore.getState()).toMatchObject({ status: "authenticated", refreshToken: "refresh_2" });

      (SecureStore.setItemAsync as jest.Mock).mockClear().mockResolvedValue(undefined);
      listeners.forEach((listener) => listener("active"));
      await new Promise<void>((resolve) => setImmediate(() => resolve()));

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        SECURE_STORE_KEYS.sessionRefreshToken,
        "refresh_2",
        expect.anything(),
      );
    });
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
    const SecureStore = require("expo-secure-store");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SECURE_STORE_KEYS.pendingRegistrationUserId);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SECURE_STORE_KEYS.pendingRegistrationAccessToken);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SECURE_STORE_KEYS.pendingRegistrationRefreshToken);
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

  it("logout() da de baja el push token del dispositivo antes de limpiar la sesión (MOVO-107 AC4)", async () => {
    const { useAuthStore } = require("../src/store/auth-store");
    const { authClient } = require("../src/api/auth-client");
    const { unregisterCurrentDevice } = require("../src/lib/push-registration");
    (authClient.logout as jest.Mock).mockResolvedValue(undefined);

    await useAuthStore.getState().setSession(REFRESHED_SESSION);
    await useAuthStore.getState().logout();

    expect(unregisterCurrentDevice).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  it("logout() tolera que la baja del push token falle y limpia la sesión igual", async () => {
    const { useAuthStore } = require("../src/store/auth-store");
    const { authClient } = require("../src/api/auth-client");
    const { unregisterCurrentDevice } = require("../src/lib/push-registration");
    (authClient.logout as jest.Mock).mockResolvedValue(undefined);
    (unregisterCurrentDevice as jest.Mock).mockRejectedValue(new Error("network"));

    await useAuthStore.getState().setSession(REFRESHED_SESSION);
    await expect(useAuthStore.getState().logout()).resolves.not.toThrow();

    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  describe("cuenta inhabilitada con la sesión abierta (MOVO-300 AC4)", () => {
    it("cierra la sesión con el motivo, sin llamar al logout del backend ni desregistrar el dispositivo", async () => {
      const { authClient } = require("../src/api/auth-client");
      const { unregisterCurrentDevice } = require("../src/lib/push-registration");
      const { useAuthStore } = require("../src/store/auth-store");
      await useAuthStore.getState().setSession(REFRESHED_SESSION);

      await useAuthStore.getState().signOutDisabledAccount();

      expect(useAuthStore.getState()).toMatchObject({ status: "unauthenticated", signOutReason: "account_disabled" });
      expect(authClient.logout).not.toHaveBeenCalled();
      expect(unregisterCurrentDevice).not.toHaveBeenCalled();
    });

    it("sin sesión no hace nada (el login de una cuenta inhabilitada lo maneja su pantalla)", async () => {
      const { useAuthStore } = require("../src/store/auth-store");
      await useAuthStore.getState().clearSession();

      await useAuthStore.getState().signOutDisabledAccount();

      expect(useAuthStore.getState().signOutReason).toBeNull();
    });

    it("el motivo se limpia al mostrarse y con una sesión nueva", async () => {
      const { useAuthStore } = require("../src/store/auth-store");
      await useAuthStore.getState().setSession(REFRESHED_SESSION);
      await useAuthStore.getState().signOutDisabledAccount();

      useAuthStore.getState().clearSignOutReason();
      expect(useAuthStore.getState().signOutReason).toBeNull();

      await useAuthStore.getState().setSession(REFRESHED_SESSION);
      await useAuthStore.getState().signOutDisabledAccount();
      await useAuthStore.getState().setSession(REFRESHED_SESSION);
      expect(useAuthStore.getState().signOutReason).toBeNull();
    });
  });
});
