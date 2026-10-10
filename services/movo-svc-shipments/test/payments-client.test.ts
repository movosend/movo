import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPaymentsClient } from "../src/adapters/payments-client";
import { createUsersClient } from "../src/adapters/users-client";

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("PaymentsClient.getCarrierMpAccountStatus (MOVO-116)", () => {
  const originalFetch = globalThis.fetch;
  const client = createPaymentsClient({ PAYMENTS_SERVICE_URL: "http://movo-svc-payments:3000" });

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

describe("UsersClient.findKycStatus (MOVO-116)", () => {
  const originalFetch = globalThis.fetch;
  const client = createUsersClient({ USERS_SERVICE_URL: "http://movo-svc-users:3000" });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("devuelve los dos estados de KYC del endpoint interno", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ kycStatusIdentity: "approved", kycStatusLicense: "pending" }),
    });
    globalThis.fetch = fetchMock;

    expect(await client.findKycStatus(USER_ID)).toEqual({ kycStatusIdentity: "approved", kycStatusLicense: "pending" });
    expect(fetchMock.mock.calls[0][0]).toBe(`http://movo-svc-users:3000/internal/users/${USER_ID}/kyc-status`);
  });

  it("null si el usuario no existe (404)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    expect(await client.findKycStatus(USER_ID)).toBeNull();
  });

  it("502 USERS_SERVICE_UNAVAILABLE ante una forma inesperada", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });

    await expect(client.findKycStatus(USER_ID)).rejects.toMatchObject({
      statusCode: 502,
      code: "USERS_SERVICE_UNAVAILABLE",
    });
  });
});
