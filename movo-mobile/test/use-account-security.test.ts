import { changePasswordAndPersistSession } from "../src/hooks/use-account-security";

const mockChangePassword = jest.fn();
jest.mock("../src/api/users-client", () => ({
  usersClient: {
    changePassword: (...args: unknown[]) => mockChangePassword(...args),
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
