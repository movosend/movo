import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { MercadoPagoClient, PaymentResponse } from "../src/adapters/mercadopago-client";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../src/utils/token-cipher";

// Integración contra Postgres y Redis reales (convención del repo); solo se reemplaza el
// cliente de MP para no pegarle al sandbox. El hold creado, consultado y liberado contra
// el sandbox real es la DoD manual del ticket (ver CLAUDE.md del servicio).

const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIPMENT_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
const BASE = "/internal/payments/holds";

function payment(overrides: Partial<PaymentResponse> = {}): PaymentResponse {
  return { id: 1352823085, status: "authorized", status_detail: "pending_capture", ...overrides } as PaymentResponse;
}

describe("/internal/payments/holds (MOVO-209)", () => {
  let app: FastifyInstance;
  let createCount = 0;
  const mp = {
    createPayment: vi.fn(async () => payment({ id: 1_000_000 + ++createCount })),
    getPayment: vi.fn(async () => payment()),
    capturePayment: vi.fn(),
    cancelPayment: vi.fn(async () => payment({ status: "cancelled", status_detail: "by_collector" })),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    process.env.MP_HOLD_VALIDITY_DAYS = "7";
    app = buildApp({ mercadoPagoClient: mp as unknown as MercadoPagoClient });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.MP_TOKEN_ENCRYPTION_KEY;
    delete process.env.MP_HOLD_VALIDITY_DAYS;
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.holds, payments.carrier_mp_accounts");
    createCount = 0;
    for (const fn of [mp.createPayment, mp.getPayment, mp.cancelPayment]) fn.mockClear();
    mp.createPayment.mockImplementation(async () => payment({ id: 1_000_000 + ++createCount }));
    mp.getPayment.mockImplementation(async () => payment());
    mp.cancelPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "by_collector" }));
    await createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).upsertLinked(
      CARRIER,
      {
        mpUserId: "2991764998",
        email: "vendedor@testuser.com",
        nickname: "TESTUSER71",
        accessToken: "TEST-access-secret",
        refreshToken: "TG-refresh-secret",
        publicKey: "TEST-public-key",
        scope: "offline_access",
        tokenExpiresAt: new Date(Date.now() + 86_400_000),
      },
      new Date()
    );
  });

  const body = (overrides: Record<string, unknown> = {}) => ({
    shipmentId: SHIPMENT,
    carrierId: CARRIER,
    cardToken: "card-token-1",
    amountArs: 1150,
    payerEmail: "test_user_4715592661702347785@testuser.com",
    paymentMethodId: "visa",
    ...overrides,
  });
  const create = (overrides: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: BASE, payload: body(overrides) });

  it("checkout-data devuelve la public_key, el monto y la comisión", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/checkout-data`,
      payload: { shipmentId: SHIPMENT, carrierId: CARRIER, amountArs: 1150, payerEmail: "e@x.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      shipmentId: SHIPMENT,
      publicKey: "TEST-public-key",
      amountArs: 1150,
      applicationFeeArs: 150,
      payerEmail: "e@x.com",
    });
  });

  it("checkout-data responde 409 explícito si el transportista no vinculó MP", async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.carrier_mp_accounts");
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/checkout-data`,
      payload: { shipmentId: SHIPMENT, carrierId: CARRIER, amountArs: 1150, payerEmail: "e@x.com" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CARRIER_MP_ACCOUNT_NOT_LINKED");
  });

  it("crea el hold, lo persiste con montos numeric y expires_at de la config (AC2-AC4)", async () => {
    const before = Date.now();
    const res = await create();
    expect(res.statusCode).toBe(201);
    const hold = res.json();
    expect(hold).toMatchObject({
      shipmentId: SHIPMENT,
      carrierId: CARRIER,
      collectorId: "2991764998",
      attempt: 1,
      mpPaymentId: "1000001",
      amountArs: 1150,
      applicationFeeArs: 150,
      status: "authorized",
      statusDetail: "pending_capture",
    });
    const expiresInMs = new Date(hold.expiresAt).getTime() - before;
    expect(expiresInMs).toBeGreaterThan(7 * 86_400_000 - 5_000);
    expect(expiresInMs).toBeLessThan(7 * 86_400_000 + 5_000);

    const [row] = await app.db.$queryRawUnsafe<Array<{ amount_ars: string; type: string }>>(
      "SELECT amount_ars::text AS amount_ars, pg_typeof(amount_ars)::text AS type FROM payments.holds"
    );
    expect(row).toEqual({ amount_ars: "1150.00", type: "numeric" });

    const [, body_, key] = mp.createPayment.mock.calls[0] as unknown as [string, Record<string, unknown>, string];
    expect(body_).toMatchObject({ capture: false, application_fee: 150, token: "card-token-1" });
    expect(key).toBe(`movo-hold-${SHIPMENT}-1`);
  });

  it("un reintento devuelve el mismo hold con 200 y no crea otro pago (AC6)", async () => {
    const first = await create();
    const second = await create({ cardToken: "card-token-reintento" });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(mp.createPayment).toHaveBeenCalledTimes(1);
  });

  it("dos requests simultáneos crean un solo hold y el pago se pide con la misma key", async () => {
    const results = await Promise.all([create(), create(), create()]);
    for (const res of results) expect([200, 201]).toContain(res.statusCode);
    const ids = new Set(results.map((r) => r.json().id));
    expect(ids.size).toBe(1);

    const keys = new Set(mp.createPayment.mock.calls.map((c) => (c as unknown as [string, unknown, string])[2]));
    expect(keys).toEqual(new Set([`movo-hold-${SHIPMENT}-1`]));
    const [{ count }] = await app.db.$queryRawUnsafe<Array<{ count: bigint }>>(
      "SELECT count(*) AS count FROM payments.holds WHERE status IN ('authorized','creating')"
    );
    expect(Number(count)).toBe(1);
  });

  it("la base impide dos holds vivos del mismo envío aunque el código falle (índice parcial)", async () => {
    await create();
    await expect(
      app.db.$executeRawUnsafe(
        `INSERT INTO payments.holds (shipment_id, attempt, carrier_id, collector_id, amount_ars,
           application_fee_ars, status, updated_at)
         VALUES ('${SHIPMENT}', 2, '${CARRIER}', '1', 100, 10, 'authorized', now())`
      )
    ).rejects.toThrow();
  });

  it("rechazo por fondos insuficientes: 201 con motivo, y el reintento usa otra key (AC5)", async () => {
    mp.createPayment.mockResolvedValueOnce(
      payment({ id: 5, status: "rejected", status_detail: "cc_rejected_insufficient_amount" })
    );
    const rejected = await create();
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json()).toMatchObject({ status: "rejected", failureReason: "insufficient_funds", attempt: 1 });

    const retry = await create({ cardToken: "otra-tarjeta" });
    expect(retry.json()).toMatchObject({ status: "authorized", attempt: 2 });
    const keys = mp.createPayment.mock.calls.map((c) => (c as unknown as [string, unknown, string])[2]);
    expect(keys).toEqual([`movo-hold-${SHIPMENT}-1`, `movo-hold-${SHIPMENT}-2`]);
  });

  it("consulta el hold por envío, 404 sin hold (AC7)", async () => {
    const missing = await app.inject({ method: "GET", url: `${BASE}/by-shipment/${SHIPMENT_2}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("HOLD_NOT_FOUND");

    await create();
    const res = await app.inject({ method: "GET", url: `${BASE}/by-shipment/${SHIPMENT}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ shipmentId: SHIPMENT, status: "authorized" });
    expect(mp.getPayment).not.toHaveBeenCalled();

    mp.getPayment.mockResolvedValueOnce(payment({ id: 1_000_001, status: "cancelled", status_detail: "expired" }));
    const synced = await app.inject({ method: "GET", url: `${BASE}/by-shipment/${SHIPMENT}?sync=true` });
    expect(synced.json()).toMatchObject({ status: "cancelled", statusDetail: "expired" });
  });

  it("libera el hold con el token del transportista y es idempotente (AC8)", async () => {
    await create();
    const released = await app.inject({ method: "POST", url: `${BASE}/by-shipment/${SHIPMENT}/release` });
    expect(released.statusCode).toBe(200);
    expect(released.json().status).toBe("cancelled");
    expect(mp.cancelPayment.mock.calls[0][0]).toBe("TEST-access-secret");
    expect(mp.cancelPayment.mock.calls[0][1]).toBe("1000001");

    const again = await app.inject({ method: "POST", url: `${BASE}/by-shipment/${SHIPMENT}/release` });
    expect(again.statusCode).toBe(200);
    expect(mp.cancelPayment).toHaveBeenCalledTimes(1);

    const none = await app.inject({ method: "POST", url: `${BASE}/by-shipment/${SHIPMENT_2}/release` });
    expect(none.statusCode).toBe(404);
  });

  it("valida el body: uuid, monto positivo y email", async () => {
    const badId = await create({ shipmentId: "no-es-uuid" });
    expect(badId.statusCode).toBe(400);
    const badAmount = await create({ amountArs: 0 });
    expect(badAmount.statusCode).toBe(400);
    const badEmail = await create({ payerEmail: "inventado" });
    expect(badEmail.statusCode).toBe(400);
    expect(mp.createPayment).not.toHaveBeenCalled();
  });

  it("no existe bajo /payments, el prefijo que sí proxea el gateway", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/payments/holds/by-shipment/${SHIPMENT}`,
      headers: { "x-user-id": CARRIER },
    });
    expect(res.statusCode).toBe(404);
  });
});
