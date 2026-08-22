import type { QueryClient } from "@tanstack/react-query";
import {
  changePasswordAndPersistSession,
  deleteAccountAndClearSession,
} from "../src/hooks/use-account-security";

const mockChangePassword = jest.fn();
const mockDeleteAccount = jest.fn();
jest.mock("../src/api/users-client", () => ({
  usersClient: {
    changePassword: (...args: unknown[]) => mockChangePassword(...args),
    deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
  },
}));

jest.mock("../src/store/auth-store", () => ({ useAuthStore: jest.fn() }));

const NEW_SESSION = {
  userId: "u-1",
  accessToken: "access-nuevo",
  refreshToken: "refresh-nuevo",
  expiresIn: 3600,
  kycStatus: "approved",
  fullName: "Juan Perez",
  roles: ["sender"],
};

/**
 * MOVO-136 AC2, el punto donde esta feature se rompe en silencio si nadie lo cubre:
 * `POST /users/me/password` revoca TODAS las sesiones del usuario y devuelve un par
 * de tokens nuevo. Si no se persiste esa respuesta, el access token en memoria sigue
 * funcionando (JWT stateless, ADR-004) y la app recién muere cuando expira — hasta 60
 * minutos después, con el refresh token ya revocado. Invisible en una prueba manual.
 */
describe("changePasswordAndPersistSession", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("persiste los tokens nuevos que devuelve el backend", async () => {
    mockChangePassword.mockResolvedValue(NEW_SESSION);
    const setSession = jest.fn().mockResolvedValue(undefined);

    const result = await changePasswordAndPersistSession(setSession, {
      currentPassword: "Password1",
      newPassword: "Password2",
    });

    expect(mockChangePassword).toHaveBeenCalledWith({
      currentPassword: "Password1",
      newPassword: "Password2",
    });
    expect(setSession).toHaveBeenCalledWith(NEW_SESSION);
    expect(result).toEqual(NEW_SESSION);
  });

  it("no resuelve hasta que la sesión nueva quedó guardada", async () => {
    mockChangePassword.mockResolvedValue(NEW_SESSION);
    let persisted = false;
    const setSession = jest.fn().mockImplementation(async () => {
      await Promise.resolve();
      persisted = true;
    });

    await changePasswordAndPersistSession(setSession, {
      currentPassword: "Password1",
      newPassword: "Password2",
    });

    // Si `setSession` no se esperara, la pantalla mostraría la confirmación con los
    // tokens nuevos todavía sin escribir en secure-store.
    expect(persisted).toBe(true);
  });

  it("no toca la sesión si el cambio falla", async () => {
    mockChangePassword.mockRejectedValue(new Error("boom"));
    const setSession = jest.fn();

    await expect(
      changePasswordAndPersistSession(setSession, {
        currentPassword: "mala",
        newPassword: "Password2",
      }),
    ).rejects.toThrow("boom");
    expect(setSession).not.toHaveBeenCalled();
  });
});

/**
 * MOVO-136 AC6: "la app vuelve al login sin sesión guardada ni caché de perfil". Las
 * dos mitades importan — `clearSession()` dispara el redirect del guard de
 * `app/(app)/_layout.tsx`, y `queryClient.clear()` evita que el perfil/envíos de la
 * cuenta recién borrada se pinten en el próximo login de otro usuario del mismo
 * dispositivo.
 */
describe("deleteAccountAndClearSession", () => {
  const makeQueryClient = () => ({ clear: jest.fn() }) as unknown as QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("borra la cuenta, limpia la caché y limpia la sesión local", async () => {
    mockDeleteAccount.mockResolvedValue(undefined);
    const clearSession = jest.fn().mockResolvedValue(undefined);
    const queryClient = makeQueryClient();

    await deleteAccountAndClearSession(clearSession, queryClient, "Password1");

    expect(mockDeleteAccount).toHaveBeenCalledWith("Password1");
    expect(queryClient.clear).toHaveBeenCalled();
    expect(clearSession).toHaveBeenCalled();
  });

  it("no resuelve hasta que la sesión local quedó limpia", async () => {
    mockDeleteAccount.mockResolvedValue(undefined);
    let cleared = false;
    const clearSession = jest.fn().mockImplementation(async () => {
      await Promise.resolve();
      cleared = true;
    });

    await deleteAccountAndClearSession(clearSession, makeQueryClient(), "Password1");

    expect(cleared).toBe(true);
  });

  it("no toca la sesión ni la caché si el backend rechaza la baja", async () => {
    // El caso real: 401 por contraseña mal, o 409 por envíos activos. En los dos la
    // cuenta sigue existiendo — desloguear ahí sería sacar al usuario de la app por
    // un error que puede corregir en la misma pantalla.
    mockDeleteAccount.mockRejectedValue(new Error("boom"));
    const clearSession = jest.fn();
    const queryClient = makeQueryClient();

    await expect(
      deleteAccountAndClearSession(clearSession, queryClient, "mala"),
    ).rejects.toThrow("boom");
    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
  });
});
