import { ApiError } from "@movo/shared/dist/errors/api-error";

const originalEnv = process.env.EXPO_PUBLIC_API_URL;

describe("http-client", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api-dev.movosend.app";
    jest.resetModules();
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalEnv;
  });

  it("arma la URL con el prefijo /api/v1 y EXPO_PUBLIC_API_URL", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: "world" }),
    });
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient } = require("../src/api/http-client");
    await httpClient.get("/kyc/status", { userId: "usr_1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-dev.movosend.app/api/v1/kyc/status?userId=usr_1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("MOVO-253: un array en la query se manda como clave repetida", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient } = require("../src/api/http-client");
    await httpClient.get("/shipments/mine", { page: 1, status: ["a", "b"] });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-dev.movosend.app/api/v1/shipments/mine?page=1&status=a&status=b",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("parsea SerializedApiError y lanza un ApiError tipado", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: "USER_EMAIL_ALREADY_EXISTS", message: "Ya existe", statusCode: 409 },
      }),
    });
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient } = require("../src/api/http-client");

    await expect(httpClient.post("/auth/register", {})).rejects.toMatchObject({
      code: "USER_EMAIL_ALREADY_EXISTS",
      statusCode: 409,
    } satisfies Partial<ApiError>);
  });

  it("MOVO-117: pasa details del error al ApiError (missingRequirements del 403)", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          code: "CARRIER_LICENSE_NOT_APPROVED",
          message: "Falta la licencia",
          statusCode: 403,
          details: { missingRequirements: ["license", "mp_account"] },
        },
      }),
    });
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient } = require("../src/api/http-client");

    await expect(httpClient.post("/trips", {})).rejects.toMatchObject({
      code: "CARRIER_LICENSE_NOT_APPROVED",
      details: { missingRequirements: ["license", "mp_account"] },
    });
  });

  it("un error sin details deja details en undefined", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: "CARRIER_NOT_VERIFIED", message: "x", statusCode: 403 } }),
    });
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient } = require("../src/api/http-client");

    await expect(httpClient.post("/trips", {})).rejects.toMatchObject({ details: undefined });
  });

  it("lanza INTERNAL_ERROR de red si fetch falla", async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error("network down"));
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient } = require("../src/api/http-client");

    await expect(httpClient.get("/kyc/status")).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });
});

describe("http-client — interceptor de sesión (MOVO-76)", () => {
  const REFRESH_SESSION = {
    userId: "usr_1",
    accessToken: "new-token",
    refreshToken: "refresh-2",
    expiresIn: 3600,
    kycStatus: "approved",
    fullName: "Julia Pérez",
    roles: ["sender"],
  };

  const EXPIRED_ERROR_BODY = {
    error: { code: "AUTH_TOKEN_EXPIRED", message: "Token vencido", statusCode: 401 },
  };

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api-dev.movosend.app";
    jest.resetModules();
  });

  function jsonRes(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }

  function buildHooks(initial: { accessToken: string | null; refreshToken: string | null }) {
    const state = { ...initial };
    const hooks = {
      getAccessToken: jest.fn(() => state.accessToken),
      getRefreshToken: jest.fn(() => state.refreshToken),
      onTokensRefreshed: jest.fn(async (session: { accessToken: string; refreshToken: string }) => {
        state.accessToken = session.accessToken;
        state.refreshToken = session.refreshToken;
      }),
      onAuthFailure: jest.fn(async () => {
        state.accessToken = null;
        state.refreshToken = null;
      }),
      onAccountDisabled: jest.fn(async () => {
        state.accessToken = null;
        state.refreshToken = null;
      }),
    };
    return { hooks, state };
  }

  it("ante 401 AUTH_TOKEN_EXPIRED refresca y reintenta transparentemente (AC4)", async () => {
    const fetchMock = jest.fn((url: string, init?: { headers?: Record<string, string> }) => {
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(jsonRes(200, REFRESH_SESSION));
      }
      if (init?.headers?.Authorization === "Bearer old-token") {
        return Promise.resolve(jsonRes(401, EXPIRED_ERROR_BODY));
      }
      return Promise.resolve(jsonRes(200, { hello: "world" }));
    });
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient, registerAuthHooks } = require("../src/api/http-client");
    const { hooks } = buildHooks({ accessToken: "old-token", refreshToken: "refresh-1" });
    registerAuthHooks(hooks);

    const result = await httpClient.get("/kyc/status");

    expect(result).toEqual({ hello: "world" });
    expect(hooks.onTokensRefreshed).toHaveBeenCalledWith(REFRESH_SESSION);
    const refreshCalls = fetchMock.mock.calls.filter((call) => call[0].includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(lastCall[1]?.headers?.Authorization).toBe("Bearer new-token");
  });

  it("un solo refresh ante varios 401 concurrentes (AC5, single-flight)", async () => {
    const fetchMock = jest.fn((url: string, init?: { headers?: Record<string, string> }) => {
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(jsonRes(200, REFRESH_SESSION));
      }
      if (init?.headers?.Authorization === "Bearer old-token") {
        return Promise.resolve(jsonRes(401, EXPIRED_ERROR_BODY));
      }
      return Promise.resolve(jsonRes(200, { hello: "world" }));
    });
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient, registerAuthHooks } = require("../src/api/http-client");
    const { hooks } = buildHooks({ accessToken: "old-token", refreshToken: "refresh-1" });
    registerAuthHooks(hooks);

    const results = await Promise.all([
      httpClient.get("/kyc/status"),
      httpClient.get("/kyc/session"),
      httpClient.get("/kyc/status"),
    ]);

    expect(results).toEqual([{ hello: "world" }, { hello: "world" }, { hello: "world" }]);
    expect(hooks.onTokensRefreshed).toHaveBeenCalledTimes(1);
    const refreshCalls = fetchMock.mock.calls.filter((call) => call[0].includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("un token revocado (401 AUTH_TOKEN_INVALID) refresca, y si la sesión murió la cierra", async () => {
    const fetchMock = jest.fn((url: string) =>
      Promise.resolve(
        url.includes("/auth/refresh")
          ? jsonRes(401, { error: { code: "AUTH_REFRESH_INVALID", message: "Refresh inválido", statusCode: 401 } })
          : jsonRes(401, { error: { code: "AUTH_TOKEN_INVALID", message: "Token revocado", statusCode: 401 } }),
      ),
    );
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient, registerAuthHooks } = require("../src/api/http-client");
    const { hooks } = buildHooks({ accessToken: "revoked-token", refreshToken: "refresh-1" });
    registerAuthHooks(hooks);

    await expect(httpClient.get("/shipments/sending")).rejects.toMatchObject({ code: "AUTH_REFRESH_INVALID" });

    expect(fetchMock.mock.calls.filter((call) => call[0].includes("/auth/refresh"))).toHaveLength(1);
    expect(hooks.onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("MOVO-346: un refresh que falla por red o 5xx no cierra la sesión", async () => {
    for (const refreshResponse of [() => Promise.reject(new Error("network down")), () => Promise.resolve(jsonRes(503, {}))]) {
      jest.resetModules();
      const fetchMock = jest.fn((url: string) =>
        url.includes("/auth/refresh") ? refreshResponse() : Promise.resolve(jsonRes(401, EXPIRED_ERROR_BODY)),
      );
      // @ts-expect-error mock global
      global.fetch = fetchMock;

      const { httpClient, registerAuthHooks } = require("../src/api/http-client");
      const { hooks } = buildHooks({ accessToken: "old-token", refreshToken: "refresh-1" });
      registerAuthHooks(hooks);

      await expect(httpClient.get("/shipments/transporting")).rejects.toBeTruthy();
      expect(hooks.onAuthFailure).not.toHaveBeenCalled();
    }
  });

  it("MOVO-346: si aplicar la sesión refrescada falla localmente, no se cierra la sesión", async () => {
    const fetchMock = jest.fn((url: string) =>
      Promise.resolve(url.includes("/auth/refresh") ? jsonRes(200, REFRESH_SESSION) : jsonRes(401, EXPIRED_ERROR_BODY)),
    );
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient, registerAuthHooks } = require("../src/api/http-client");
    const { hooks } = buildHooks({ accessToken: "old-token", refreshToken: "refresh-1" });
    hooks.onTokensRefreshed.mockRejectedValue(new Error("errSecInteractionNotAllowed"));
    registerAuthHooks(hooks);

    await expect(httpClient.get("/shipments/transporting")).rejects.toThrow("errSecInteractionNotAllowed");
    expect(hooks.onAuthFailure).not.toHaveBeenCalled();
  });

  it("no reintenta si el que falló es el propio /auth/refresh (evita loop infinito)", async () => {
    const fetchMock = jest.fn((url: string, init?: { headers?: Record<string, string> }) => {
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(
          jsonRes(401, { error: { code: "AUTH_REFRESH_INVALID", message: "Refresh inválido", statusCode: 401 } }),
        );
      }
      if (init?.headers?.Authorization === "Bearer old-token") {
        return Promise.resolve(jsonRes(401, EXPIRED_ERROR_BODY));
      }
      return Promise.resolve(jsonRes(200, { hello: "world" }));
    });
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient, registerAuthHooks } = require("../src/api/http-client");
    const { hooks } = buildHooks({ accessToken: "old-token", refreshToken: "refresh-1" });
    registerAuthHooks(hooks);

    await expect(httpClient.get("/kyc/status")).rejects.toMatchObject({ code: "AUTH_REFRESH_INVALID" });
    expect(hooks.onAuthFailure).toHaveBeenCalledTimes(1);
    // Un solo intento de refresh — no hay recursión ante un /auth/refresh que a su vez falla.
    const refreshCalls = fetchMock.mock.calls.filter((call) => call[0].includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("no dispara refresh ante AUTH_INVALID_CREDENTIALS (no es un token vencido)", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonRes(401, {
        error: { code: "AUTH_INVALID_CREDENTIALS", message: "Credenciales inválidas", statusCode: 401 },
      }),
    );
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient, registerAuthHooks } = require("../src/api/http-client");
    const { hooks } = buildHooks({ accessToken: "old-token", refreshToken: "refresh-1" });
    registerAuthHooks(hooks);

    await expect(httpClient.post("/auth/login", {})).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hooks.onAuthFailure).not.toHaveBeenCalled();
  });

  it("refresh fallido limpia la sesión (AC6) sin llegar a pegarle a /auth/refresh si no hay refreshToken", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonRes(401, EXPIRED_ERROR_BODY));
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient, registerAuthHooks } = require("../src/api/http-client");
    const { hooks } = buildHooks({ accessToken: "old-token", refreshToken: null });
    registerAuthHooks(hooks);

    await expect(httpClient.get("/kyc/status")).rejects.toMatchObject({ code: "AUTH_REFRESH_INVALID" });
    expect(hooks.onAuthFailure).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un 401 con Authorization explícito (token ajeno a la sesión) no dispara refresh de la sesión", async () => {
    // Regresión: `use-registration.tsx` (onboarding, MOVO-73) llama a `getKycStatus`
    // con un token propio pasado a mano vía `headers.Authorization`, no el de la
    // sesión. Antes del fix, un 401 ahí igual disparaba un refresh de la SESIÓN real —
    // si eso corría en paralelo con otro refresh legítimo, la rotación de un solo uso
    // (ADR-013) detectaba reuso y revocaba todas las sesiones del usuario.
    const fetchMock = jest.fn().mockResolvedValue(jsonRes(401, EXPIRED_ERROR_BODY));
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient, registerAuthHooks } = require("../src/api/http-client");
    const { hooks } = buildHooks({ accessToken: "session-token", refreshToken: "session-refresh" });
    registerAuthHooks(hooks);

    await expect(
      httpClient.get("/kyc/status", undefined, { Authorization: "Bearer onboarding-token" }),
    ).rejects.toMatchObject({ code: "AUTH_TOKEN_EXPIRED" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hooks.getRefreshToken).not.toHaveBeenCalled();
    expect(hooks.onAuthFailure).not.toHaveBeenCalled();
  });

  describe("sanciones de cuenta (MOVO-300)", () => {
    const errorBody = (code: string) => ({ error: { code, message: code, statusCode: 403 } });

    it("un 403 ACCOUNT_SUSPENDED avisa al listener y relanza el error", async () => {
      // @ts-expect-error mock global
      global.fetch = jest.fn().mockResolvedValue(jsonRes(403, errorBody("ACCOUNT_SUSPENDED")));
      const { httpClient, registerAuthHooks, registerAccountSuspendedListener } = require("../src/api/http-client");
      const { hooks } = buildHooks({ accessToken: "token", refreshToken: "refresh" });
      registerAuthHooks(hooks);
      const listener = jest.fn();
      registerAccountSuspendedListener(listener);

      await expect(httpClient.post("/trips", {})).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(hooks.onAccountDisabled).not.toHaveBeenCalled();
    });

    it("un 403 ACCOUNT_DISABLED cierra la sesión por el hook y relanza el error", async () => {
      // @ts-expect-error mock global
      global.fetch = jest.fn().mockResolvedValue(jsonRes(403, errorBody("ACCOUNT_DISABLED")));
      const { httpClient, registerAuthHooks } = require("../src/api/http-client");
      const { hooks } = buildHooks({ accessToken: "token", refreshToken: "refresh" });
      registerAuthHooks(hooks);

      await expect(httpClient.get("/shipments/mine")).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });

      expect(hooks.onAccountDisabled).toHaveBeenCalledTimes(1);
    });

    it("un refresh rechazado con ACCOUNT_DISABLED cierra la sesión con ese motivo, no como un fallo genérico", async () => {
      // @ts-expect-error mock global
      global.fetch = jest.fn((url: string) =>
        Promise.resolve(
          url.includes("/auth/refresh")
            ? jsonRes(403, errorBody("ACCOUNT_DISABLED"))
            : jsonRes(401, EXPIRED_ERROR_BODY),
        ),
      );
      const { httpClient, registerAuthHooks } = require("../src/api/http-client");
      const { hooks } = buildHooks({ accessToken: "token", refreshToken: "refresh" });
      registerAuthHooks(hooks);

      await expect(httpClient.get("/users/me")).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });

      expect(hooks.onAccountDisabled).toHaveBeenCalledTimes(1);
      expect(hooks.onAuthFailure).not.toHaveBeenCalled();
    });

    it("un token revocado (401 AUTH_TOKEN_INVALID) de una cuenta inhabilitada cierra la sesión con ese motivo", async () => {
      // Inhabilitar revoca el access token: el gateway responde 401, no 403, y el refresh
      // es el que dice por qué.
      // @ts-expect-error mock global
      global.fetch = jest.fn((url: string) =>
        Promise.resolve(
          url.includes("/auth/refresh")
            ? jsonRes(403, errorBody("ACCOUNT_DISABLED"))
            : jsonRes(401, { error: { code: "AUTH_TOKEN_INVALID", message: "Token revocado", statusCode: 401 } }),
        ),
      );
      const { httpClient, registerAuthHooks } = require("../src/api/http-client");
      const { hooks } = buildHooks({ accessToken: "token", refreshToken: "refresh" });
      registerAuthHooks(hooks);

      await expect(httpClient.get("/shipments/sending")).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });

      expect(hooks.onAccountDisabled).toHaveBeenCalledTimes(1);
      expect(hooks.onAuthFailure).not.toHaveBeenCalled();
    });

    it("otro 403 (p. ej. requisitos del transportista) no toca la sesión ni el listener", async () => {
      // @ts-expect-error mock global
      global.fetch = jest.fn().mockResolvedValue(jsonRes(403, errorBody("CARRIER_LICENSE_NOT_APPROVED")));
      const { httpClient, registerAuthHooks, registerAccountSuspendedListener } = require("../src/api/http-client");
      const { hooks } = buildHooks({ accessToken: "token", refreshToken: "refresh" });
      registerAuthHooks(hooks);
      const listener = jest.fn();
      registerAccountSuspendedListener(listener);

      await expect(httpClient.post("/trips", {})).rejects.toMatchObject({ code: "CARRIER_LICENSE_NOT_APPROVED" });

      expect(listener).not.toHaveBeenCalled();
      expect(hooks.onAccountDisabled).not.toHaveBeenCalled();
    });
  });
});
