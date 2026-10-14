import type Redis from "ioredis";
import { ApiError } from "@movo/shared";
import { MERCADOPAGO_TIMEOUT_MS } from "./mercadopago-client";
import { MERCADOPAGO_API_URL } from "./mercadopago-oauth-client";

/** Tarjeta guardada en un customer de MP, con lo que MP devuelve para mostrarla. */
export interface MpSavedCard {
  id: string;
  /** `payment_method.id` (`visa`, `master`, ...). */
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/**
 * MOVO-100 (ADR-039): única puerta hacia Customers & Cards de MP, siempre con el token de
 * la cuenta de MOVO S.A. (no el de un transportista): la tarjeta del emisor vive en un
 * customer de Movo y de ahí se deriva un token por transportista al pagar.
 */
export interface MercadoPagoCustomersClient {
  /** Falla con `MercadoPagoCustomersError.isCustomerAlreadyExists` si el email ya tiene customer. */
  createCustomer(email: string): Promise<{ id: string }>;
  findCustomerByEmail(email: string): Promise<{ id: string } | null>;
  /** `false` solo si MP responde 404 (el customer fue borrado); cualquier otra falla tira. */
  customerExists(customerId: string): Promise<boolean>;
  /** Guarda la tarjeta de un `card_token` de un solo uso (generado con la `public_key` de Movo). */
  saveCard(customerId: string, cardToken: string): Promise<MpSavedCard>;
  /** Un 404 (ya no existe) se toma como borrada. */
  deleteCard(customerId: string, mpCardId: string): Promise<void>;
  /** Borra el customer y, con él, sus tarjetas. Un 404 se toma como borrado. */
  deleteCustomer(customerId: string): Promise<void>;
}

/**
 * Error de una llamada a Customers & Cards. Lleva el status HTTP y el `code` de MP
 * (`cause[0].code`), nunca el body: puede repetir el email del emisor o datos de la tarjeta.
 */
export class MercadoPagoCustomersError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number | null,
    readonly providerCode: string | null,
    message: string
  ) {
    super(message);
    this.name = "MercadoPagoCustomersError";
  }

  /** MP responde 400 con el código 101 al crear un customer con un email que ya tiene uno. */
  get isCustomerAlreadyExists(): boolean {
    return this.operation === "create_customer" && this.status === 400 && this.providerCode === "101";
  }
}

export interface MovoMpCredentials {
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** `MP_TEST_MODE`: pide un token `TEST-`. Sin él, en sandbox MP responde 401 300 (live credentials). */
  testMode: boolean;
}

/** Margen antes del vencimiento real con el que se renueva el token cacheado. */
const TOKEN_EXPIRY_MARGIN_SECONDS = 300;
const MIN_TOKEN_TTL_SECONDS = 60;

/**
 * Token de la app de Movo (`POST /oauth/token`, `grant_type=client_credentials`), cacheado en
 * Redis hasta poco antes de vencer. Nunca se loguea. La key incluye el modo para que un
 * token `TEST-` jamás se sirva como live (ni al revés) si se cambia `MP_TEST_MODE`.
 */
export class MovoTokenProvider {
  constructor(
    private readonly redis: Redis,
    private readonly credentials: MovoMpCredentials,
    private readonly timeoutMs: number = MERCADOPAGO_TIMEOUT_MS,
    private readonly baseUrl: string = MERCADOPAGO_API_URL
  ) {}

  private get cacheKey(): string {
    return `mp:movo-token:${this.credentials.testMode ? "test" : "live"}`;
  }

  async getToken(): Promise<string> {
    const { clientId, clientSecret, testMode } = this.credentials;
    if (!clientId || !clientSecret) {
      throw new ApiError(503, "CARDS_NOT_CONFIGURED", "Las tarjetas guardadas no están configuradas en este ambiente.");
    }

    const cached = await this.redis.get(this.cacheKey);
    if (cached) return cached;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
          ...(testMode ? { test_token: true } : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "unknown";
      throw new MercadoPagoCustomersError("movo_token", null, null, `MP no respondió (${reason})`);
    }
    if (!response.ok) {
      throw new MercadoPagoCustomersError("movo_token", response.status, null, `MP respondió ${response.status}`);
    }

    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      throw new MercadoPagoCustomersError("movo_token", 200, null, "Respuesta de /oauth/token incompleta");
    }
    if (testMode && !body.access_token.startsWith("TEST-")) {
      // Sandbox con un token live: MP rechazaría el customer con 401 300. Mejor fallar acá.
      throw new MercadoPagoCustomersError("movo_token", 200, null, "MP devolvió un token que no es TEST- en modo test");
    }

    const ttl = Math.max(body.expires_in - TOKEN_EXPIRY_MARGIN_SECONDS, MIN_TOKEN_TTL_SECONDS);
    await this.redis.set(this.cacheKey, body.access_token, "EX", ttl);
    return body.access_token;
  }

  /**
   * Saca del cache un token que MP rechazó (revocado, secret rotado), así el próximo
   * `getToken` pide uno nuevo en vez de seguir fallando hasta que venza. Solo borra si el
   * cacheado sigue siendo ese: otro request pudo haberlo renovado mientras tanto.
   */
  async invalidate(rejectedToken: string): Promise<void> {
    if ((await this.redis.get(this.cacheKey)) === rejectedToken) {
      await this.redis.del(this.cacheKey);
    }
  }
}

interface MpCardBody {
  id?: unknown;
  last_four_digits?: unknown;
  expiration_month?: unknown;
  expiration_year?: unknown;
  payment_method?: { id?: unknown } | null;
}

function parseCard(body: MpCardBody): MpSavedCard {
  const { id, last_four_digits, expiration_month, expiration_year, payment_method } = body;
  const brand = payment_method?.id;
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    typeof last_four_digits !== "string" ||
    typeof expiration_month !== "number" ||
    typeof expiration_year !== "number" ||
    typeof brand !== "string"
  ) {
    throw new MercadoPagoCustomersError("save_card", 200, null, "Respuesta de guardar tarjeta incompleta");
  }
  return { id: String(id), brand, last4: last_four_digits, expMonth: expiration_month, expYear: expiration_year };
}

export class FetchMercadoPagoCustomersClient implements MercadoPagoCustomersClient {
  constructor(
    private readonly tokens: MovoTokenProvider,
    private readonly timeoutMs: number = MERCADOPAGO_TIMEOUT_MS,
    private readonly baseUrl: string = MERCADOPAGO_API_URL
  ) {}

  async createCustomer(email: string): Promise<{ id: string }> {
    const response = await this.request("create_customer", "/v1/customers", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== "string") {
      throw new MercadoPagoCustomersError("create_customer", response.status, null, "Respuesta de crear customer incompleta");
    }
    return { id: body.id };
  }

  async findCustomerByEmail(email: string): Promise<{ id: string } | null> {
    const response = await this.request(
      "find_customer",
      `/v1/customers/search?email=${encodeURIComponent(email)}`,
      { method: "GET" }
    );
    const body = (await response.json()) as { results?: Array<{ id?: unknown }> };
    const first = body.results?.[0];
    return first && typeof first.id === "string" ? { id: first.id } : null;
  }

  async customerExists(customerId: string): Promise<boolean> {
    const response = await this.request(
      "get_customer",
      `/v1/customers/${encodeURIComponent(customerId)}`,
      { method: "GET" },
      { tolerate404: true }
    );
    return response.status !== 404;
  }

  async saveCard(customerId: string, cardToken: string): Promise<MpSavedCard> {
    const response = await this.request("save_card", `/v1/customers/${encodeURIComponent(customerId)}/cards`, {
      method: "POST",
      body: JSON.stringify({ token: cardToken }),
    });
    return parseCard((await response.json()) as MpCardBody);
  }

  async deleteCard(customerId: string, mpCardId: string): Promise<void> {
    await this.request(
      "delete_card",
      `/v1/customers/${encodeURIComponent(customerId)}/cards/${encodeURIComponent(mpCardId)}`,
      { method: "DELETE" },
      { tolerate404: true }
    );
  }

  async deleteCustomer(customerId: string): Promise<void> {
    await this.request(
      "delete_customer",
      `/v1/customers/${encodeURIComponent(customerId)}`,
      { method: "DELETE" },
      { tolerate404: true }
    );
  }

  private async request(
    operation: string,
    path: string,
    init: RequestInit,
    opts: { tolerate404?: boolean } = {},
    retryOnAuthError = true
  ): Promise<Response> {
    const token = await this.tokens.getToken();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "unknown";
      throw new MercadoPagoCustomersError(operation, null, null, `MP no respondió (${reason})`);
    }
    if (response.ok || (opts.tolerate404 && response.status === 404)) return response;
    if (retryOnAuthError && (response.status === 401 || response.status === 403)) {
      // Token cacheado que MP ya no acepta: se descarta y se reintenta una vez con uno nuevo.
      await this.tokens.invalidate(token);
      return this.request(operation, path, init, opts, false);
    }

    let providerCode: string | null = null;
    try {
      const body = (await response.json()) as { cause?: Array<{ code?: unknown }>; code?: unknown };
      const raw = body.cause?.[0]?.code ?? body.code;
      providerCode = raw === undefined || raw === null ? null : String(raw);
    } catch {
      // Body vacío o no JSON: solo queda el status.
    }
    throw new MercadoPagoCustomersError(operation, response.status, providerCode, `MP respondió ${response.status}`);
  }
}
