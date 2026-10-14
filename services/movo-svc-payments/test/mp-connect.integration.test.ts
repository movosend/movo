import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { MpConnectStatusResponse } from "@movo/shared";
import { buildApp } from "../src/app";
import {
  MercadoPagoAccountInfo,
  MercadoPagoOAuthClient,
  MercadoPagoOAuthError,
  OAuthTokens,
  RefreshedTokens,
} from "../src/adapters/mercadopago-oauth-client";
import { MP_CONNECT_STATE_TTL_SECONDS, pkceChallenge } from "../src/modules/mp-connect/mp-connect-state-store";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../src/utils/token-cipher";

// Integración contra Postgres y Redis reales (convención del repo); solo se reemplaza
// el adapter de OAuth para no pegarle a Mercado Pago. El flujo contra el sandbox real
// es la DoD manual del ticket.

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const REDIRECT_URI = "https://api-dev.movosend.app/api/v1/payments/mp-connect/callback";
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

function tokens(overrides: Partial<OAuthTokens> = {}): OAuthTokens {
  return {
    accessToken: "TEST-access-secret",
    refreshToken: "TG-refresh-secret",
    mpUserId: "2991764998",
    publicKey: "TEST-public-key",
    scope: "offline_access read write",
    expiresInSeconds: 15552000,
    ...overrides,
  };
}

class FakeOAuthClient implements MercadoPagoOAuthClient {
  exchangeCode = vi.fn(async (): Promise<OAuthTokens> => tokens());
  getAccountInfo = vi.fn(
    async (): Promise<MercadoPagoAccountInfo> => ({ email: "vendedor@testuser.com", nickname: "TESTUSER71" })
  );
  refreshTokens = vi.fn(
    async (): Promise<RefreshedTokens> => ({
      accessToken: "TEST-access-refreshed",
      refreshToken: "TG-refresh-rotated",
      scope: "offline_access read write",
      expiresInSeconds: 15552000,
    })
  );
}

describe("/payments/mp-connect (MOVO-111)", () => {
  let app: FastifyInstance;
  const oauth = new FakeOAuthClient();

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_CLIENT_ID = "7550835762771398";
    process.env.MP_CLIENT_SECRET = "client-secret";
    process.env.MP_REDIRECT_URI = REDIRECT_URI;
    process.env.MP_TEST_MODE = "true";
    process.env.MP_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    app = buildApp({ mercadoPagoOAuthClient: oauth });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    for (const key of ["MP_CLIENT_ID", "MP_CLIENT_SECRET", "MP_REDIRECT_URI", "MP_TEST_MODE", "MP_TOKEN_ENCRYPTION_KEY"]) {
      delete process.env[key];
    }
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.carrier_mp_accounts");
    const keys = [
      ...(await app.redis.keys("mp_connect_state:*")),
      ...(await app.redis.keys("mp_refresh_invalid_grant:*")),
      ...(await app.redis.keys("mp_refresh_pending:*")),
    ];
    if (keys.length > 0) await app.redis.del(...keys);
    oauth.exchangeCode.mockReset().mockImplementation(async () => tokens());
    oauth.refreshTokens.mockReset().mockImplementation(async () => ({
      accessToken: "TEST-access-refreshed",
      refreshToken: "TG-refresh-rotated",
      scope: "offline_access read write",
      expiresInSeconds: 15552000,
    }));
    oauth.getAccountInfo
      .mockReset()
      .mockImplementation(async () => ({ email: "vendedor@testuser.com", nickname: "TESTUSER71" }));
  });

  const as = (userId: string) => ({ "x-user-id": userId });
  const credentials = (userId: string) =>
    createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).findCredentials(userId);

  async function getStatus(userId: string): Promise<MpConnectStatusResponse> {
    const response = await app.inject({ method: "GET", url: "/payments/mp-connect/status", headers: as(userId) });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  /** Pide la URL de autorización y devuelve el `state` que lleva. */
  async function startAuthorization(userId: string): Promise<string> {
    const response = await app.inject({
      method: "GET",
      url: "/payments/mp-connect/authorization-url",
      headers: as(userId),
    });
    expect(response.statusCode).toBe(200);
    return new URL(response.json().authorizationUrl).searchParams.get("state") as string;
  }

  async function callback(query: string) {
    return app.inject({ method: "GET", url: `/payments/mp-connect/callback?${query}` });
  }

  async function link(userId: string) {
    const state = await startAuthorization(userId);
    const response = await callback(`code=TG-code&state=${state}`);
    expect(response.headers.location).toBe("movo://mp-connect?result=success");
  }

  describe("GET /status", () => {
    it("unlinked sin vinculación", async () => {
      expect(await getStatus(USER_A)).toEqual({ status: "unlinked", account: null, invalidReason: null });
    });

    it("exige x-user-id (hook de paymentsRoutes)", async () => {
      const response = await app.inject({ method: "GET", url: "/payments/mp-connect/status" });
      expect(response.statusCode).toBe(401);
    });

    it("linked después de vincular, con la cuenta y sin tokens", async () => {
      await link(USER_A);

      const status = await getStatus(USER_A);
      expect(status.status).toBe("linked");
      expect(status.invalidReason).toBeNull();
      expect(status.account).toMatchObject({
        mpUserId: "2991764998",
        email: "vendedor@testuser.com",
        nickname: "TESTUSER71",
      });
      expect(JSON.stringify(status)).not.toContain("secret");
    });

    it("invalid/revoked con revoked_at (MOVO-243), devolviendo igual la cuenta", async () => {
      await link(USER_A);
      await app.db.carrierMpAccount.update({ where: { userId: USER_A }, data: { revokedAt: new Date() } });

      const status = await getStatus(USER_A);
      expect(status).toMatchObject({ status: "invalid", invalidReason: "revoked" });
      expect(status.account?.mpUserId).toBe("2991764998");
    });

    it("invalid/expired con token_expires_at vencido", async () => {
      await link(USER_A);
      await app.db.carrierMpAccount.update({
        where: { userId: USER_A },
        data: { tokenExpiresAt: new Date(Date.now() - 1000) },
      });

      expect(await getStatus(USER_A)).toMatchObject({ status: "invalid", invalidReason: "expired" });
    });
  });

  describe("GET /internal/payments/mp-connect/:userId/status (MOVO-116)", () => {
    async function getInternalStatus(userId: string): Promise<{ linked: boolean }> {
      const response = await app.inject({ method: "GET", url: `/internal/payments/mp-connect/${userId}/status` });
      expect(response.statusCode).toBe(200);
      return response.json();
    }

    it("linked: false sin cuenta", async () => {
      expect(await getInternalStatus(USER_A)).toEqual({ linked: false });
    });

    it("linked: true con una cuenta vigente, sin depender de x-user-id", async () => {
      await link(USER_A);

      expect(await getInternalStatus(USER_A)).toEqual({ linked: true });
      expect(await getInternalStatus(USER_B)).toEqual({ linked: false });
    });

    it("linked: false después de desvincular", async () => {
      await link(USER_A);
      await app.inject({ method: "DELETE", url: "/payments/mp-connect", headers: as(USER_A) });

      expect(await getInternalStatus(USER_A)).toEqual({ linked: false });
    });

    it("linked: false con la cuenta revocada", async () => {
      await link(USER_A);
      await app.db.carrierMpAccount.update({ where: { userId: USER_A }, data: { revokedAt: new Date() } });

      expect(await getInternalStatus(USER_A)).toEqual({ linked: false });
    });

    it("linked: false con el token vencido", async () => {
      await link(USER_A);
      await app.db.carrierMpAccount.update({
        where: { userId: USER_A },
        data: { tokenExpiresAt: new Date(Date.now() - 1000) },
      });

      expect(await getInternalStatus(USER_A)).toEqual({ linked: false });
    });

    it("linked: false sin public_key, mismo criterio que el hold (el status público dice linked)", async () => {
      await link(USER_A);
      await app.db.carrierMpAccount.update({ where: { userId: USER_A }, data: { publicKey: null } });

      expect((await getStatus(USER_A)).status).toBe("linked");
      expect(await getInternalStatus(USER_A)).toEqual({ linked: false });
    });

    it("400 si el userId no es un uuid", async () => {
      const response = await app.inject({ method: "GET", url: "/internal/payments/mp-connect/no-es-uuid/status" });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /authorization-url", () => {
    it("arma la URL de MP con PKCE S256 y offline_access, y guarda el state en Redis", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/payments/mp-connect/authorization-url",
        headers: as(USER_A),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const url = new URL(body.authorizationUrl);
      expect(url.origin + url.pathname).toBe("https://auth.mercadopago.com/authorization");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        client_id: "7550835762771398",
        response_type: "code",
        platform_id: "mp",
        redirect_uri: REDIRECT_URI,
        scope: "offline_access",
        code_challenge_method: "S256",
      });

      const state = url.searchParams.get("state") as string;
      const stored = JSON.parse((await app.redis.get(`mp_connect_state:${state}`)) as string);
      expect(stored.userId).toBe(USER_A);
      expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge(stored.codeVerifier));

      const ttl = await app.redis.ttl(`mp_connect_state:${state}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(MP_CONNECT_STATE_TTL_SECONDS);
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it.each([["MP_CLIENT_ID"], ["MP_TOKEN_ENCRYPTION_KEY"]] as const)(
      "503 MP_CONNECT_NOT_CONFIGURED si falta %s",
      async (name) => {
        const original = app.config[name];
        app.config[name] = "";
        try {
          const response = await app.inject({
            method: "GET",
            url: "/payments/mp-connect/authorization-url",
            headers: as(USER_A),
          });
          expect(response.statusCode).toBe(503);
          expect(response.json().error.code).toBe("MP_CONNECT_NOT_CONFIGURED");
        } finally {
          app.config[name] = original;
        }
      }
    );
  });

  describe("GET /callback", () => {
    it("canjea el code con el verifier del state y persiste tokens, public_key y datos de la cuenta", async () => {
      const state = await startAuthorization(USER_A);
      const { codeVerifier } = JSON.parse((await app.redis.get(`mp_connect_state:${state}`)) as string);

      const response = await callback(`code=TG-code&state=${state}`);

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("movo://mp-connect?result=success");
      expect(oauth.exchangeCode).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: "7550835762771398", redirectUri: REDIRECT_URI, testToken: true }),
        { code: "TG-code", codeVerifier }
      );
      expect(oauth.getAccountInfo).toHaveBeenCalledWith("TEST-access-secret");

      const row = await app.db.carrierMpAccount.findUniqueOrThrow({ where: { userId: USER_A } });
      // Cifrados en la base (review de PR #223); descifrados solo por findCredentials.
      expect(row.accessToken).toMatch(/^v1:/);
      expect(row.refreshToken).toMatch(/^v1:/);
      expect(JSON.stringify(row)).not.toContain("access-secret");
      expect(JSON.stringify(row)).not.toContain("refresh-secret");
      expect(await credentials(USER_A)).toMatchObject({
        mpUserId: "2991764998",
        accessToken: "TEST-access-secret",
        refreshToken: "TG-refresh-secret",
        publicKey: "TEST-public-key",
        tokenExpiresAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
      expect(row).toMatchObject({
        mpUserId: "2991764998",
        publicKey: "TEST-public-key",
        scope: "offline_access read write",
        revokedAt: null,
        unlinkedAt: null,
      });
      const expectedExpiry = Date.now() + 15552000 * 1000;
      expect(Math.abs((row.tokenExpiresAt as Date).getTime() - expectedExpiry)).toBeLessThan(60_000);
    });

    it("el state es de un solo uso: reusarlo responde MP_CONNECT_STATE_INVALID", async () => {
      const state = await startAuthorization(USER_A);
      await callback(`code=TG-code&state=${state}`);

      const response = await callback(`code=TG-code&state=${state}`);

      expect(response.headers.location).toBe("movo://mp-connect?result=error&code=MP_CONNECT_STATE_INVALID");
      expect(oauth.exchangeCode).toHaveBeenCalledTimes(1);
    });

    it.each([["code=TG-code&state=inexistente"], ["code=TG-code"], [""]])(
      "state inexistente o ausente (%s) → MP_CONNECT_STATE_INVALID, sin canjear",
      async (query) => {
        const response = await callback(query);

        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe("movo://mp-connect?result=error&code=MP_CONNECT_STATE_INVALID");
        expect(oauth.exchangeCode).not.toHaveBeenCalled();
      }
    );

    it("el transportista rechazó en MP → MP_CONNECT_ACCESS_DENIED, y el state queda consumido", async () => {
      const state = await startAuthorization(USER_A);

      const response = await callback(`error=access_denied&state=${state}`);

      expect(response.headers.location).toBe("movo://mp-connect?result=error&code=MP_CONNECT_ACCESS_DENIED");
      expect(await app.redis.get(`mp_connect_state:${state}`)).toBeNull();
      expect(await getStatus(USER_A)).toMatchObject({ status: "unlinked" });
    });

    it("falla el canje → MP_CONNECT_EXCHANGE_FAILED y no persiste nada", async () => {
      oauth.exchangeCode.mockRejectedValueOnce(new MercadoPagoOAuthError("exchange_code", 400, "MP respondió 400"));
      const state = await startAuthorization(USER_A);

      const response = await callback(`code=TG-code&state=${state}`);

      expect(response.headers.location).toBe("movo://mp-connect?result=error&code=MP_CONNECT_EXCHANGE_FAILED");
      expect(await getStatus(USER_A)).toMatchObject({ status: "unlinked" });
    });

    it("falla /users/me → vincula igual, sin email ni nickname (best-effort)", async () => {
      oauth.getAccountInfo.mockRejectedValueOnce(new MercadoPagoOAuthError("get_account_info", 500, "MP respondió 500"));
      const state = await startAuthorization(USER_A);

      const response = await callback(`code=TG-code&state=${state}`);

      expect(response.headers.location).toBe("movo://mp-connect?result=success");
      expect(await getStatus(USER_A)).toMatchObject({
        status: "linked",
        account: { mpUserId: "2991764998", email: null, nickname: null },
      });
    });

    it("Redis caído al consumir el state → 302 con MP_CONNECT_EXCHANGE_FAILED, no un 500", async () => {
      const state = await startAuthorization(USER_A);
      const spy = vi.spyOn(app.redis, "getdel").mockRejectedValueOnce(new Error("Connection is closed."));
      try {
        const response = await callback(`code=TG-code&state=${state}`);

        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe("movo://mp-connect?result=error&code=MP_CONNECT_EXCHANGE_FAILED");
      } finally {
        spy.mockRestore();
      }
    });

    it("un query que no matchea el schema (state repetido) → 302 con MP_CONNECT_STATE_INVALID, no un 400", async () => {
      const response = await callback("code=TG-code&state=a&state=b");

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("movo://mp-connect?result=error&code=MP_CONNECT_STATE_INVALID");
      expect(oauth.exchangeCode).not.toHaveBeenCalled();
    });

    it("con MP_TEST_MODE, un token sin prefijo TEST- se rechaza", async () => {
      oauth.exchangeCode.mockResolvedValueOnce(tokens({ accessToken: "APP_USR-real" }));
      const state = await startAuthorization(USER_A);

      const response = await callback(`code=TG-code&state=${state}`);

      expect(response.headers.location).toBe("movo://mp-connect?result=error&code=MP_CONNECT_EXCHANGE_FAILED");
      expect(oauth.getAccountInfo).not.toHaveBeenCalled();
    });

    it("la misma cuenta de MP activa en otro usuario → MP_ACCOUNT_ALREADY_LINKED", async () => {
      await link(USER_A);
      const state = await startAuthorization(USER_B);

      const response = await callback(`code=TG-code&state=${state}`);

      expect(response.headers.location).toBe("movo://mp-connect?result=error&code=MP_ACCOUNT_ALREADY_LINKED");
      expect(await getStatus(USER_B)).toMatchObject({ status: "unlinked" });
      expect(await getStatus(USER_A)).toMatchObject({ status: "linked" });
    });

    it("una cuenta de MP desvinculada por otro usuario sí se puede vincular", async () => {
      await link(USER_A);
      await app.inject({ method: "DELETE", url: "/payments/mp-connect", headers: as(USER_A) });

      await link(USER_B);

      expect(await getStatus(USER_B)).toMatchObject({ status: "linked" });
    });

    it("re-vincular desde invalid limpia revoked_at y pisa los tokens", async () => {
      await link(USER_A);
      await app.db.carrierMpAccount.update({ where: { userId: USER_A }, data: { revokedAt: new Date() } });
      oauth.exchangeCode.mockResolvedValueOnce(tokens({ accessToken: "TEST-nuevo", refreshToken: "TG-nuevo" }));

      await link(USER_A);

      expect(await getStatus(USER_A)).toMatchObject({ status: "linked" });
      expect(await credentials(USER_A)).toMatchObject({ accessToken: "TEST-nuevo", refreshToken: "TG-nuevo" });
      expect(await app.db.carrierMpAccount.count()).toBe(1);
    });
  });

  describe("DELETE /", () => {
    it("desvincula: 204, status unlinked (no invalid) y tokens borrados", async () => {
      await link(USER_A);

      const response = await app.inject({ method: "DELETE", url: "/payments/mp-connect", headers: as(USER_A) });

      expect(response.statusCode).toBe(204);
      expect(await getStatus(USER_A)).toEqual({ status: "unlinked", account: null, invalidReason: null });
      const row = await app.db.carrierMpAccount.findUniqueOrThrow({ where: { userId: USER_A } });
      expect(row.accessToken).toBeNull();
      expect(row.refreshToken).toBeNull();
      expect(row.unlinkedAt).not.toBeNull();
      expect(await credentials(USER_A)).toBeNull();
    });

    it("es idempotente: 204 sin nada vinculado", async () => {
      const response = await app.inject({ method: "DELETE", url: "/payments/mp-connect", headers: as(USER_A) });

      expect(response.statusCode).toBe(204);
    });

    it("re-vincular después de desvincular vuelve a linked", async () => {
      await link(USER_A);
      await app.inject({ method: "DELETE", url: "/payments/mp-connect", headers: as(USER_A) });

      await link(USER_A);

      expect(await getStatus(USER_A)).toMatchObject({ status: "linked" });
    });
  });

  describe("renovación de tokens (MOVO-243)", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const repo = () => createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY));
    const setExpiry = (userId: string, daysFromNow: number) =>
      app.db.carrierMpAccount.update({
        where: { userId },
        data: { tokenExpiresAt: new Date(Date.now() + daysFromNow * DAY_MS) },
      });
    const relinkedAccount = (accessToken: string, refreshToken: string) => ({
      mpUserId: "2991764998",
      email: null,
      nickname: null,
      accessToken,
      refreshToken,
      publicKey: "TEST-public-key",
      scope: null,
      tokenExpiresAt: new Date(Date.now() + 100 * DAY_MS),
    });
    const oauthError = (status: number | null, errorCode: string | null) =>
      new MercadoPagoOAuthError("refresh_token", status, "MP respondió", errorCode);

    it("renueva lo que vence dentro de la ventana y guarda los DOS tokens nuevos (AC1, AC2)", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 5);

      const summary = await app.mpConnect.refreshDueTokens();

      expect(summary).toMatchObject({ checked: 1, refreshed: 1, revoked: 0, failed: 0 });
      expect(oauth.refreshTokens).toHaveBeenCalledWith(
        { clientId: "7550835762771398", clientSecret: "client-secret", testToken: true },
        "TG-refresh-secret"
      );
      expect(await credentials(USER_A)).toMatchObject({
        accessToken: "TEST-access-refreshed",
        refreshToken: "TG-refresh-rotated",
      });
      const row = await app.db.carrierMpAccount.findUniqueOrThrow({ where: { userId: USER_A } });
      expect(row.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 179 * DAY_MS);
      // En la base siguen cifrados.
      expect(row.accessToken).not.toContain("refreshed");
      expect(row.refreshToken).not.toContain("rotated");
      expect((await getStatus(USER_A)).status).toBe("linked");
    });

    it("no toca los tokens que todavía no están por vencer", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 100);

      const summary = await app.mpConnect.refreshDueTokens();

      expect(summary.checked).toBe(0);
      expect(oauth.refreshTokens).not.toHaveBeenCalled();
    });

    it("intenta recuperar un token ya vencido, y si MP lo renueva vuelve a linked", async () => {
      await link(USER_A);
      await setExpiry(USER_A, -1);
      expect((await getStatus(USER_A)).invalidReason).toBe("expired");

      await app.mpConnect.refreshDueTokens();

      expect((await getStatus(USER_A)).status).toBe("linked");
    });

    it("invalid_grant en dos corridas seguidas marca revoked_at y deja de reintentarse (AC3)", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 5);
      oauth.refreshTokens.mockRejectedValue(oauthError(400, "invalid_grant"));

      // La primera vez solo se registra: podría ser otra corrida que ya canjeó el token.
      expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ checked: 1, revoked: 0, failed: 1 });
      expect((await getStatus(USER_A)).status).toBe("linked");

      expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ checked: 1, revoked: 1, refreshed: 0 });
      expect(await getStatus(USER_A)).toMatchObject({ status: "invalid", invalidReason: "revoked" });
      expect(await credentials(USER_A)).toBeNull();

      oauth.refreshTokens.mockClear();
      expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ checked: 0 });
      expect(oauth.refreshTokens).not.toHaveBeenCalled();
    });

    it("un invalid_grant aislado seguido de un refresh exitoso limpia el conteo", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 5);
      oauth.refreshTokens.mockRejectedValueOnce(oauthError(400, "invalid_grant"));
      await app.mpConnect.refreshDueTokens();

      expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ refreshed: 1 });
      await setExpiry(USER_A, 5);
      oauth.refreshTokens.mockRejectedValueOnce(oauthError(400, "invalid_grant"));
      expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ revoked: 0, failed: 1 });
      expect((await getStatus(USER_A)).status).toBe("linked");
    });

    it("si el token cambió entre dos invalid_grant (otra corrida lo rotó), el conteo arranca de cero", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 5);
      oauth.refreshTokens.mockRejectedValueOnce(oauthError(400, "invalid_grant"));
      await app.mpConnect.refreshDueTokens();

      await repo().upsertLinked(USER_A, relinkedAccount("TEST-new", "TG-new"), new Date());
      await setExpiry(USER_A, 5);
      oauth.refreshTokens.mockRejectedValueOnce(oauthError(400, "invalid_grant"));

      expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ revoked: 0, failed: 1 });
      expect((await getStatus(USER_A)).status).toBe("linked");
    });

    it("si la base no vuelve, los tokens ya rotados quedan cifrados en Redis y la corrida siguiente los persiste sin llamar a MP", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 5);
      const updateMany = vi.spyOn(app.db.carrierMpAccount, "updateMany");
      updateMany.mockRejectedValueOnce(new Error("db caída"));
      updateMany.mockRejectedValueOnce(new Error("db caída"));
      updateMany.mockRejectedValueOnce(new Error("db caída"));

      try {
        expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ checked: 1, refreshed: 0, failed: 1 });
      } finally {
        updateMany.mockRestore();
      }
      // La base sigue con el token viejo, pero el nuevo está respaldado y cifrado.
      expect(await credentials(USER_A)).toMatchObject({ refreshToken: "TG-refresh-secret" });
      const backup = await app.redis.get(`mp_refresh_pending:${USER_A}`);
      expect(backup).not.toBeNull();
      expect(backup).not.toContain("TG-refresh-rotated");
      expect(oauth.refreshTokens).toHaveBeenCalledTimes(1);

      expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ checked: 1, refreshed: 1, failed: 0 });

      expect(oauth.refreshTokens).toHaveBeenCalledTimes(1);
      expect(await credentials(USER_A)).toMatchObject({
        accessToken: "TEST-access-refreshed",
        refreshToken: "TG-refresh-rotated",
      });
      expect(await app.redis.get(`mp_refresh_pending:${USER_A}`)).toBeNull();
      expect((await getStatus(USER_A)).status).toBe("linked");
    });

    it("un respaldo de un token que ya no es el de la base (re-vinculó) se descarta", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 5);
      const updateMany = vi.spyOn(app.db.carrierMpAccount, "updateMany");
      for (let i = 0; i < 3; i += 1) updateMany.mockRejectedValueOnce(new Error("db caída"));
      try {
        await app.mpConnect.refreshDueTokens();
      } finally {
        updateMany.mockRestore();
      }
      await repo().upsertLinked(USER_A, relinkedAccount("TEST-relinked", "TG-relinked"), new Date());
      await setExpiry(USER_A, 5);

      await app.mpConnect.refreshDueTokens();

      // Se pidió un refresh nuevo sobre el token de la re-vinculación, sin usar el respaldo.
      expect(oauth.refreshTokens).toHaveBeenLastCalledWith(expect.anything(), "TG-relinked");
      expect(await app.redis.get(`mp_refresh_pending:${USER_A}`)).toBeNull();
    });

    it("si el guardado falla después de que MP rotó el token, se reintenta con una pausa corta", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 5);
      const updateMany = vi.spyOn(app.db.carrierMpAccount, "updateMany");
      updateMany.mockRejectedValueOnce(new Error("db caída"));

      try {
        expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ refreshed: 1, failed: 0 });
      } finally {
        updateMany.mockRestore();
      }
      expect(oauth.refreshTokens).toHaveBeenCalledTimes(1);
      expect(await credentials(USER_A)).toMatchObject({ refreshToken: "TG-refresh-rotated" });
    });

    it("una fila ilegible se omite y no frena la renovación de las demás", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 1);
      await app.db.carrierMpAccount.update({ where: { userId: USER_A }, data: { refreshToken: "basura-no-cifrada" } });
      oauth.exchangeCode.mockImplementation(async () => tokens({ mpUserId: "555" }));
      await link(USER_B);
      await setExpiry(USER_B, 4);

      const summary = await app.mpConnect.refreshDueTokens();

      expect(summary).toMatchObject({ checked: 1, refreshed: 1 });
      expect(await credentials(USER_B)).toMatchObject({ refreshToken: "TG-refresh-rotated" });
    });

    it("una fila que falla rota al final del lote y no acapara los lugares", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 1);
      oauth.exchangeCode.mockImplementation(async () => tokens({ mpUserId: "555" }));
      await link(USER_B);
      await setExpiry(USER_B, 4);
      const due = new Date(Date.now() + 30 * DAY_MS);

      const first = await repo().findDueForRefresh(due, 1);
      expect(first[0].userId).toBe(USER_A);
      await repo().touchRefreshAttempt(USER_A, first[0].version, new Date(Date.now() + 1000));

      const second = await repo().findDueForRefresh(due, 1);
      expect(second[0].userId).toBe(USER_B);
    });

    it("un fallo transitorio no marca revoked_at y se reintenta en la próxima corrida (AC4)", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 5);
      oauth.refreshTokens.mockRejectedValueOnce(oauthError(503, null));

      expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ checked: 1, failed: 1, revoked: 0 });
      const row = await app.db.carrierMpAccount.findUniqueOrThrow({ where: { userId: USER_A } });
      expect(row.revokedAt).toBeNull();
      expect(await credentials(USER_A)).toMatchObject({ refreshToken: "TG-refresh-secret" });

      expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ checked: 1, refreshed: 1 });
      expect(await credentials(USER_A)).toMatchObject({ refreshToken: "TG-refresh-rotated" });
    });

    it("un error de red tampoco revoca", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 5);
      oauth.refreshTokens.mockRejectedValueOnce(oauthError(null, null));

      await app.mpConnect.refreshDueTokens();

      const row = await app.db.carrierMpAccount.findUniqueOrThrow({ where: { userId: USER_A } });
      expect(row.revokedAt).toBeNull();
    });

    it("un fallo en una cuenta no frena a las demás", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 3);
      oauth.exchangeCode.mockImplementation(async () => tokens({ mpUserId: "555" }));
      await link(USER_B);
      await setExpiry(USER_B, 4);
      oauth.refreshTokens.mockRejectedValueOnce(oauthError(500, null));

      const summary = await app.mpConnect.refreshDueTokens();

      expect(summary).toMatchObject({ checked: 2, failed: 1, refreshed: 1 });
    });

    it("ignora las cuentas desvinculadas", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 5);
      await repo().unlink(USER_A, new Date());

      expect((await app.mpConnect.refreshDueTokens()).checked).toBe(0);
    });

    it("si el transportista re-vincula mientras se espera a MP, no se pisa la vinculación nueva", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 5);
      oauth.refreshTokens.mockImplementationOnce(async () => {
        await repo().upsertLinked(
          USER_A,
          relinkedAccount("TEST-relinked", "TG-relinked"),
          new Date()
        );
        return { accessToken: "TEST-stale", refreshToken: "TG-stale", scope: null, expiresInSeconds: 15552000 };
      });

      expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ refreshed: 0, skipped: 1 });
      expect(await credentials(USER_A)).toMatchObject({ accessToken: "TEST-relinked", refreshToken: "TG-relinked" });
    });

    it("un invalid_grant sobre una vinculación re-hecha en el medio no la revoca", async () => {
      await link(USER_A);
      await setExpiry(USER_A, 5);
      oauth.refreshTokens.mockImplementation(async () => {
        await repo().upsertLinked(USER_A, relinkedAccount("TEST-relinked", "TG-relinked"), new Date());
        throw oauthError(400, "invalid_grant");
      });

      await app.mpConnect.refreshDueTokens();
      expect(await app.mpConnect.refreshDueTokens()).toMatchObject({ revoked: 0 });
      expect((await getStatus(USER_A)).status).toBe("linked");
    });
  });
});
