import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPaymentsClient } from "../src/adapters/payments-client";
import { createUsersClient } from "../src/adapters/users-client";

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("PaymentsClient.getCarrierMpAccountStatus (MOVO-116)", () => {
  const originalFetch = globalThis.fetch;
  const client = createPaymentsClient({
    PAYMENTS_SERVICE_URL: "http://movo-svc-payments:3000",
    USER_DEBT_OVERDUE_DAYS: 14,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("consulta el endpoint interno sin x-user-id y devuelve linked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ linked: true }) });
    globalThis.fetch = fetchMock;

    expect(await client.getCarrierMpAccountStatus(USER_ID)).toEqual({ linked: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://movo-svc-payments:3000/internal/payments/mp-connect/${USER_ID}/status`);
    expect(init.method).toBe("GET");
    expect(init.headers).toBeUndefined();
  });

  it("502 PAYMENTS_SERVICE_UNAVAILABLE si la red falla", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(client.getCarrierMpAccountStatus(USER_ID)).rejects.toMatchObject({
      statusCode: 502,
      code: "PAYMENTS_SERVICE_UNAVAILABLE",
    });
  });

  it("502 si svc-payments responde un error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(client.getCarrierMpAccountStatus(USER_ID)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("502 ante una forma inesperada: nunca se lee como vinculada ni como no vinculada", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: "linked" }) });

    await expect(client.getCarrierMpAccountStatus(USER_ID)).rejects.toMatchObject({
      statusCode: 502,
      code: "PAYMENTS_SERVICE_UNAVAILABLE",
    });
  });
});

describe("PaymentsClient.getUserDebtStatus (MOVO-313, ADR-044)", () => {
  const originalFetch = globalThis.fetch;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const NOW = new Date("2026-10-30T12:00:00.000Z");
  const client = createPaymentsClient({
    PAYMENTS_SERVICE_URL: "http://movo-svc-payments:3000",
    USER_DEBT_OVERDUE_DAYS: 14,
  });

  function respondWith(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: () => Promise.resolve(body),
    });
    globalThis.fetch = fetchMock;
    return fetchMock;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("consulta el saldo interno sin x-user-id, en cada llamada (sin cache)", async () => {
    const fetchMock = respondWith({ balanceArs: 0, oldestUnpaidAt: null });

    await client.getUserDebtStatus(USER_ID, NOW);
    await client.getUserDebtStatus(USER_ID, NOW);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://movo-svc-payments:3000/internal/payments/users/${USER_ID}/balance`);
    expect(init.method).toBe("GET");
    expect(init.headers).toBeUndefined();
  });

  it("deuda de más de 14 días: overdue", async () => {
    const oldestUnpaidAt = new Date(NOW.getTime() - 15 * DAY_MS).toISOString();
    respondWith({ balanceArs: 4200, oldestUnpaidAt });

    expect(await client.getUserDebtStatus(USER_ID, NOW)).toEqual({
      overdue: true,
      balanceArs: 4200,
      oldestUnpaidAt,
    });
  });

  it("deuda de menos de 14 días: no overdue", async () => {
    const oldestUnpaidAt = new Date(NOW.getTime() - 13 * DAY_MS).toISOString();
    respondWith({ balanceArs: 4200, oldestUnpaidAt });

    expect(await client.getUserDebtStatus(USER_ID, NOW)).toMatchObject({ overdue: false, balanceArs: 4200 });
  });

  it("usa el umbral configurado, no un 14 fijo", async () => {
    const strict = createPaymentsClient({ PAYMENTS_SERVICE_URL: "http://p:3000", USER_DEBT_OVERDUE_DAYS: 3 });
    respondWith({ balanceArs: 100, oldestUnpaidAt: new Date(NOW.getTime() - 5 * DAY_MS).toISOString() });

    expect((await strict.getUserDebtStatus(USER_ID, NOW)).overdue).toBe(true);
    expect((await client.getUserDebtStatus(USER_ID, NOW)).overdue).toBe(false);
  });

  it.each([undefined, Number.NaN, -1, Number.POSITIVE_INFINITY])(
    "un umbral inválido (%s) corta al armar el cliente: nunca falla abierto en silencio",
    (days) => {
      expect(() =>
        createPaymentsClient({
          PAYMENTS_SERVICE_URL: "http://p:3000",
          USER_DEBT_OVERDUE_DAYS: days as unknown as number,
        }),
      ).toThrow(/USER_DEBT_OVERDUE_DAYS/);
    },
  );

  it("sin deuda (saldo 0 o a favor): no overdue", async () => {
    respondWith({ balanceArs: -300, oldestUnpaidAt: null });

    expect(await client.getUserDebtStatus(USER_ID, NOW)).toMatchObject({ overdue: false });
  });

  it("502 PAYMENTS_SERVICE_UNAVAILABLE si la red falla (falla cerrado)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(client.getUserDebtStatus(USER_ID, NOW)).rejects.toMatchObject({
      statusCode: 502,
      code: "PAYMENTS_SERVICE_UNAVAILABLE",
    });
  });

  it("502 si svc-payments responde un error", async () => {
    respondWith({}, { ok: false, status: 500 });

    await expect(client.getUserDebtStatus(USER_ID, NOW)).rejects.toMatchObject({
      statusCode: 502,
      code: "PAYMENTS_SERVICE_UNAVAILABLE",
    });
  });

  it.each([
    ["sin balanceArs", { oldestUnpaidAt: null }],
    ["balanceArs que no es número", { balanceArs: "4200", oldestUnpaidAt: null }],
    ["sin oldestUnpaidAt", { balanceArs: 4200 }],
    ["fecha ilegible", { balanceArs: 4200, oldestUnpaidAt: "no-es-una-fecha" }],
    ["cuerpo vacío", {}],
  ])("502 ante una forma inesperada (%s): nunca se lee como sin deuda ni como vencida", async (_label, body) => {
    respondWith(body);

    await expect(client.getUserDebtStatus(USER_ID, NOW)).rejects.toMatchObject({
      statusCode: 502,
      code: "PAYMENTS_SERVICE_UNAVAILABLE",
    });
  });
});

describe("UsersClient.findKycStatus (MOVO-116)", () => {
  const originalFetch = globalThis.fetch;
  const client = createUsersClient({ USERS_SERVICE_URL: "http://movo-svc-users:3000" });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("devuelve los dos estados de KYC y el de la cuenta (MOVO-265) del endpoint interno", async () => {
    const body = {
      kycStatusIdentity: "approved",
      kycStatusLicense: "pending",
      accountStatus: "active",
      bannedUntil: "2030-01-01T00:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) });
    globalThis.fetch = fetchMock;

    expect(await client.findKycStatus(USER_ID)).toEqual(body);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://movo-svc-users:3000/internal/users/${USER_ID}/kyc-status`);
  });

  it("null si el usuario no existe (404)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    expect(await client.findKycStatus(USER_ID)).toBeNull();
  });

  it("tolera un svc-users anterior a MOVO-265, sin el estado de la cuenta", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ kycStatusIdentity: "approved", kycStatusLicense: "approved" }),
    });

    expect(await client.findKycStatus(USER_ID)).toEqual({ kycStatusIdentity: "approved", kycStatusLicense: "approved" });
  });

  it("502 USERS_SERVICE_UNAVAILABLE ante una forma inesperada", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });

    await expect(client.findKycStatus(USER_ID)).rejects.toMatchObject({
      statusCode: 502,
      code: "USERS_SERVICE_UNAVAILABLE",
    });
  });
});
