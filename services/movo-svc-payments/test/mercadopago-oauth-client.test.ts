import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FetchMercadoPagoOAuthClient,
  MercadoPagoOAuthError,
  OAuthAppCredentials,
} from "../src/adapters/mercadopago-oauth-client";

const credentials: OAuthAppCredentials = {
  clientId: "7550835762771398",
  clientSecret: "client-secret",
  redirectUri: "https://api-dev.movosend.app/api/v1/payments/mp-connect/callback",
  testToken: false,
};

// Respuesta real de /oauth/token en sandbox (SOLUCION-FINAL §3), con tokens inventados.
const tokenResponse = {
  access_token: "TEST-access",
  refresh_token: "TG-refresh",
  user_id: 2991764998,
  public_key: "TEST-public-key",
  scope: "offline_access read write",
  expires_in: 15552000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("FetchMercadoPagoOAuthClient (MOVO-111)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("canjea el code con PKCE, sin header Authorization y sin test_token fuera de sandbox", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(tokenResponse));
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await new FetchMercadoPagoOAuthClient().exchangeCode(credentials, {
      code: "TG-code",
      codeVerifier: "verifier",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/oauth/token");
    expect(init.method).toBe("POST");
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "authorization_code",
      code: "TG-code",
      redirect_uri: credentials.redirectUri,
      code_verifier: "verifier",
    });
    expect(tokens).toEqual({
      accessToken: "TEST-access",
      refreshToken: "TG-refresh",
      mpUserId: "2991764998",
      publicKey: "TEST-public-key",
      scope: "offline_access read write",
      expiresInSeconds: 15552000,
    });
  });

  it("suma test_token: true en sandbox", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(tokenResponse));
    vi.stubGlobal("fetch", fetchMock);

    await new FetchMercadoPagoOAuthClient().exchangeCode(
      { ...credentials, testToken: true },
      { code: "TG-code", codeVerifier: "verifier" }
    );

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.test_token).toBe(true);
  });

  it("un non-2xx tira MercadoPagoOAuthError con el status y sin el body de MP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "invalid_grant TG-code" }, 400)));

    const error = await new FetchMercadoPagoOAuthClient()
      .exchangeCode(credentials, { code: "TG-code", codeVerifier: "v" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MercadoPagoOAuthError);
    expect((error as MercadoPagoOAuthError).status).toBe(400);
    expect((error as Error).message).not.toContain("TG-code");
  });

  it("una respuesta sin public_key se trata como canje fallido", async () => {
    const { public_key: _omit, ...withoutPublicKey } = tokenResponse;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(withoutPublicKey)));

    await expect(
      new FetchMercadoPagoOAuthClient().exchangeCode(credentials, { code: "c", codeVerifier: "v" })
    ).rejects.toBeInstanceOf(MercadoPagoOAuthError);
  });

  it("un error de red o timeout se envuelve en MercadoPagoOAuthError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));

    const error = await new FetchMercadoPagoOAuthClient()
      .exchangeCode(credentials, { code: "c", codeVerifier: "v" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MercadoPagoOAuthError);
    expect((error as MercadoPagoOAuthError).status).toBeNull();
  });

  it("getAccountInfo consulta /users/me con el token del vendedor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 2991764998, email: "vendedor@testuser.com", nickname: "TESTUSER71" }));
    vi.stubGlobal("fetch", fetchMock);

    const info = await new FetchMercadoPagoOAuthClient().getAccountInfo("TEST-access");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/users/me");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TEST-access");
    expect(info).toEqual({ email: "vendedor@testuser.com", nickname: "TESTUSER71" });
  });

  it("getAccountInfo tolera email/nickname ausentes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ id: 1 })));

    expect(await new FetchMercadoPagoOAuthClient().getAccountInfo("t")).toEqual({ email: null, nickname: null });
  });
});
