import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { MpConnectStatusResponse } from "@movo/shared";
import { buildApp } from "../src/app";
import {
  MercadoPagoAccountInfo,
  MercadoPagoOAuthClient,
  MercadoPagoOAuthError,
  OAuthTokens,
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
    const keys = await app.redis.keys("mp_connect_state:*");
    if (keys.length > 0) await app.redis.del(...keys);
    oauth.exchangeCode.mockReset().mockImplementation(async () => tokens());
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
      expect(await credentials(USER_A)).toEqual({
        mpUserId: "2991764998",
        accessToken: "TEST-access-secret",
        refreshToken: "TG-refresh-secret",
        publicKey: "TEST-public-key",
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
});
