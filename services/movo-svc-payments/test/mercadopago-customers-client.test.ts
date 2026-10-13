import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from "vitest";
import Redis from "ioredis";
import { ApiError } from "@movo/shared";
import {
  FetchMercadoPagoCustomersClient,
  MercadoPagoCustomersError,
  MovoTokenProvider,
} from "../src/adapters/mercadopago-customers-client";

const CREDENTIALS = { clientId: "7550835762771398", clientSecret: "client-secret-value", testMode: true };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("MovoTokenProvider (MOVO-100 AC2)", () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  });
  afterAll(async () => {
    await redis.quit();
  });
  beforeEach(async () => {
    await redis.del("mp:movo-token:test", "mp:movo-token:live");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pide client_credentials con test_token en modo test y lo cachea hasta poco antes de vencer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: "TEST-movo-token", expires_in: 21600 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MovoTokenProvider(redis, CREDENTIALS);

    expect(await provider.getToken()).toBe("TEST-movo-token");
    expect(await provider.getToken()).toBe("TEST-movo-token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/oauth/token");
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: CREDENTIALS.clientId,
      client_secret: CREDENTIALS.clientSecret,
      grant_type: "client_credentials",
      test_token: true,
    });
    const ttl = await redis.ttl("mp:movo-token:test");
    expect(ttl).toBeGreaterThan(21600 - 300 - 10);
    expect(ttl).toBeLessThanOrEqual(21600 - 300);
  });

  it("fuera de modo test no manda test_token y cachea en otra key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: "APP_USR-live-token", expires_in: 21600 }));
    vi.stubGlobal("fetch", fetchMock);
    await new MovoTokenProvider(redis, { ...CREDENTIALS, testMode: false }).getToken();
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).not.toHaveProperty("test_token");
    expect(await redis.get("mp:movo-token:live")).toBe("APP_USR-live-token");
    expect(await redis.get("mp:movo-token:test")).toBeNull();
  });

  it("en modo test rechaza (y no cachea) un token que no es TEST-", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ access_token: "APP_USR-live", expires_in: 21600 })));
    await expect(new MovoTokenProvider(redis, CREDENTIALS).getToken()).rejects.toBeInstanceOf(MercadoPagoCustomersError);
    expect(await redis.get("mp:movo-token:test")).toBeNull();
  });

  it("sin client_id/client_secret responde 503 CARDS_NOT_CONFIGURED sin llamar a MP", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = await new MovoTokenProvider(redis, { ...CREDENTIALS, clientSecret: "" }).getToken().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 503, code: "CARDS_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("el error de MP lleva solo el status: ni el body ni el secret", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "client-secret-value inválido" }, 401)));
    const error = await new MovoTokenProvider(redis, CREDENTIALS).getToken().catch((e) => e);
    expect(error).toMatchObject({ status: 401 });
    expect(error.message).not.toContain("client-secret-value");
  });
});

describe("FetchMercadoPagoCustomersClient (MOVO-100)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const tokens = { getToken: async () => "TEST-movo-token" } as unknown as MovoTokenProvider;
  const client = () => new FetchMercadoPagoCustomersClient(tokens);

  it("guarda la tarjeta con el Bearer de Movo y devuelve los metadatos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { id: 8765432100, last_four_digits: "6351", expiration_month: 11, expiration_year: 2030, payment_method: { id: "visa" } },
        201
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const card = await client().saveCard("cust 1", "card-token");

    expect(card).toEqual({ id: "8765432100", brand: "visa", last4: "6351", expMonth: 11, expYear: 2030 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/v1/customers/cust%201/cards");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TEST-movo-token");
    expect(JSON.parse(init.body as string)).toEqual({ token: "card-token" });
  });

  it("crea el customer y reconoce el 101 (ya existe) por el código de MP, sin guardar el body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "emisor@example.com ya existe", cause: [{ code: "101" }] }, 400))
    );
    const error = await client().createCustomer("emisor@example.com").catch((e) => e);
    expect(error).toBeInstanceOf(MercadoPagoCustomersError);
    expect(error.isCustomerAlreadyExists).toBe(true);
    expect(error.message).not.toContain("emisor@example.com");
  });

  it("busca un customer por email", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [{ id: "cust-9" }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await client().findCustomerByEmail("a+b@example.com")).toEqual({ id: "cust-9" });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://api.mercadopago.com/v1/customers/search?email=a%2Bb%40example.com");
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    expect(await client().findCustomerByEmail("nadie@example.com")).toBeNull();
  });

  it("borrar una tarjeta o customer que ya no existe (404) se da por borrado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "not found" }, 404)));
    await expect(client().deleteCard("cust", "card")).resolves.toBeUndefined();
    await expect(client().deleteCustomer("cust")).resolves.toBeUndefined();
  });

  it("otros errores al borrar sí fallan, con el status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    await expect(client().deleteCard("cust", "card")).rejects.toMatchObject({ operation: "delete_card", status: 500 });
  });

  it("un timeout o red caída es un error sin status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(client().saveCard("cust", "tok")).rejects.toMatchObject({ status: null });
  });

  it("una respuesta incompleta al guardar es un error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ id: "1" }, 201)));
    await expect(client().saveCard("cust", "tok")).rejects.toBeInstanceOf(MercadoPagoCustomersError);
  });
});
