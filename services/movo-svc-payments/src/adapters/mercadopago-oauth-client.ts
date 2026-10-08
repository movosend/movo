import { MERCADOPAGO_TIMEOUT_MS } from "./mercadopago-client";

export const MERCADOPAGO_API_URL = "https://api.mercadopago.com";

export interface OAuthAppCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Solo sandbox (`MP_TEST_MODE`): pide un access_token `TEST-` del vendedor de prueba. */
  testToken: boolean;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** `user_id` de MP del vendedor, como string (MP lo devuelve numérico). */
  mpUserId: string;
  publicKey: string;
  scope: string | null;
  expiresInSeconds: number;
}

export interface MercadoPagoAccountInfo {
  email: string | null;
  nickname: string | null;
}

/**
 * MOVO-111: OAuth del transportista contra Mercado Pago, con `fetch` propio y no con el
 * SDK (SOLUCION-FINAL §4): `OAuth.create()` no tipa `code_verifier`/`test_token` y
 * siempre manda un `Authorization` con un access token de la app que `/oauth/token` no
 * necesita (MP autentica el canje solo con `client_id` + `client_secret`). MOVO-243 suma
 * acá el refresh (`grant_type=refresh_token`), mismo endpoint y misma forma de respuesta.
 */
export interface MercadoPagoOAuthClient {
  exchangeCode(
    credentials: OAuthAppCredentials,
    input: { code: string; codeVerifier: string }
  ): Promise<OAuthTokens>;
  /** `GET /users/me` con el token del vendedor: `/oauth/token` no devuelve email ni nickname. */
  getAccountInfo(accessToken: string): Promise<MercadoPagoAccountInfo>;
}

/**
 * Error de una llamada de OAuth a MP. Lleva solo el status HTTP: el body de MP puede
 * repetir el code o datos de la cuenta, así que no viaja en el mensaje ni en el log.
 */
export class MercadoPagoOAuthError extends Error {
  constructor(
    readonly operation: "exchange_code" | "get_account_info",
    readonly status: number | null,
    message: string
  ) {
    super(message);
    this.name = "MercadoPagoOAuthError";
  }
}

interface TokenResponseBody {
  access_token?: unknown;
  refresh_token?: unknown;
  user_id?: unknown;
  public_key?: unknown;
  scope?: unknown;
  expires_in?: unknown;
}

function parseTokens(body: TokenResponseBody): OAuthTokens {
  const { access_token, refresh_token, user_id, public_key, scope, expires_in } = body;
  if (
    typeof access_token !== "string" ||
    typeof refresh_token !== "string" ||
    (typeof user_id !== "number" && typeof user_id !== "string") ||
    typeof public_key !== "string" ||
    typeof expires_in !== "number"
  ) {
    throw new MercadoPagoOAuthError("exchange_code", 200, "Respuesta de /oauth/token incompleta");
  }
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    mpUserId: String(user_id),
    publicKey: public_key,
    scope: typeof scope === "string" ? scope : null,
    expiresInSeconds: expires_in,
  };
}

export class FetchMercadoPagoOAuthClient implements MercadoPagoOAuthClient {
  constructor(
    private readonly timeoutMs: number = MERCADOPAGO_TIMEOUT_MS,
    private readonly baseUrl: string = MERCADOPAGO_API_URL
  ) {}

  async exchangeCode(
    credentials: OAuthAppCredentials,
    input: { code: string; codeVerifier: string }
  ): Promise<OAuthTokens> {
    const body = {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: credentials.redirectUri,
      code_verifier: input.codeVerifier,
      ...(credentials.testToken ? { test_token: true } : {}),
    };
    const response = await this.request("exchange_code", "/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    return parseTokens((await response.json()) as TokenResponseBody);
  }

  async getAccountInfo(accessToken: string): Promise<MercadoPagoAccountInfo> {
    const response = await this.request("get_account_info", "/users/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    const body = (await response.json()) as { email?: unknown; nickname?: unknown };
    return {
      email: typeof body.email === "string" ? body.email : null,
      nickname: typeof body.nickname === "string" ? body.nickname : null,
    };
  }

  private async request(
    operation: MercadoPagoOAuthError["operation"],
    path: string,
    init: RequestInit
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "unknown";
      throw new MercadoPagoOAuthError(operation, null, `MP no respondió (${reason})`);
    }
    if (!response.ok) {
      throw new MercadoPagoOAuthError(operation, response.status, `MP respondió ${response.status}`);
    }
    return response;
  }
}
