import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { MercadoPagoClient, PaymentResponse } from "../src/adapters/mercadopago-client";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../src/utils/token-cipher";

// Integración contra Postgres y Redis reales (convención del repo); solo se reemplaza el
// cliente de MP. La captura real contra el sandbox es `captures.sandbox.test.ts`.

const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
const MP_PAYMENT = "1352823085";
const CAPTURE = `/internal/payments/holds/by-shipment/${SHIPMENT}/capture`;
const SETTLEMENT = `/internal/payments/holds/by-shipment/${SHIPMENT}/settlement`;

function payment(overrides: Record<string, unknown> = {}): PaymentResponse {
  return {
    id: Number(MP_PAYMENT),
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 1000,
    fee_details: [
      { type: "mercadopago_fee", amount: 41, fee_payer: "collector" },
      { type: "application_fee", amount: 150, fee_payer: "collector" },
    ],
    transaction_details: { net_received_amount: 809 },
    ...overrides,
  } as unknown as PaymentResponse;
}

describe("captura y liquidación (MOVO-212)", () => {
  let app: FastifyInstance;
  const mp = {
    createPayment: vi.fn(),
    getPayment: vi.fn(async () => payment()),
    capturePayment: vi.fn(async () => payment()),
    cancelPayment: vi.fn(),
    searchPaymentsByExternalReference: vi.fn(async () => []),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    app = buildApp({ mercadoPagoClient: mp as unknown as MercadoPagoClient });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.MP_TOKEN_ENCRYPTION_KEY;
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE payments.settlements, payments.holds, payments.carrier_mp_accounts CASCADE"
    );
    mp.capturePayment.mockReset().mockImplementation(async () => payment());
    mp.getPayment.mockReset().mockImplementation(async () => payment());
    await createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).upsertLinked(
      CARRIER,
      {
        mpUserId: "1000000001",
        email: "vendedor@example.com",
        nickname: "VENDEDOR",
        accessToken: "TEST-access-secret",
        refreshToken: "TG-refresh-secret",
        publicKey: "TEST-public-key",
        scope: "offline_access",
        tokenExpiresAt: new Date(Date.now() + 86_400_000),
      },
      new Date()
    );
  });

  const seedHold = (status: "authorized" | "rejected" = "authorized") =>
    app.db.hold.create({
      data: {
        shipmentId: SHIPMENT,
        attempt: 1,
        carrierId: CARRIER,
        collectorId: "1000000001",
        mpPaymentId: MP_PAYMENT,
        amountArs: 1000,
        applicationFeeArs: 150,
        baseAmountArs: 1000,
        commissionArs: 150,
        status,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

  it("MOVO-302: la captura completa la tarjeta que el hold no tenía, sin pisar una que ya tenía", async () => {
    // El desglose (y la tarjeta) salen de `getPayment`, la lectura posterior a la captura.
    mp.getPayment.mockImplementation(async () =>
      payment({ payment_method_id: "visa", card: { last_four_digits: "4242" } })
    );
    await seedHold();

    const res = await app.inject({ method: "POST", url: CAPTURE });

    expect(res.statusCode).toBe(200);
    expect(await app.db.hold.findFirstOrThrow({ where: { shipmentId: SHIPMENT } })).toMatchObject({
      status: "captured",
      cardLast4: "4242",
      cardBrand: "visa",
    });

    // Con la tarjeta ya guardada, otra respuesta con una distinta no la reescribe.
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.settlements, payments.holds CASCADE");
    mp.getPayment.mockImplementation(async () =>
      payment({ payment_method_id: "visa", card: { last_four_digits: "9999" } })
    );
    await app.db.hold.create({
      data: {
        shipmentId: SHIPMENT,
        attempt: 1,
        carrierId: CARRIER,
        collectorId: "1000000001",
        mpPaymentId: MP_PAYMENT,
        amountArs: 1000,
        applicationFeeArs: 150,
        baseAmountArs: 1000,
        commissionArs: 150,
        status: "authorized",
        cardLast4: "1881",
        cardBrand: "master",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await app.inject({ method: "POST", url: CAPTURE });
    expect(await app.db.hold.findFirstOrThrow({ where: { shipmentId: SHIPMENT } })).toMatchObject({
      cardLast4: "1881",
      cardBrand: "master",
    });
  });

  it("captura el hold, persiste la liquidación con numeric y deja el hold captured", async () => {
    await seedHold();

    const res = await app.inject({ method: "POST", url: CAPTURE });

    expect(res.statusCode).toBe(200);
    expect(res.json().settlement).toMatchObject({
      status: "credited",
      grossAmountArs: 1000,
      mpFeeArs: 41,
      commissionArs: 150,
      netAmountArs: 809,
    });
    const row = await app.db.settlement.findUniqueOrThrow({ where: { shipmentId: SHIPMENT } });
    expect(row.netAmountArs.toString()).toBe("809");
    expect(row.capturedAt).not.toBeNull();
    expect((await app.db.hold.findFirstOrThrow({ where: { shipmentId: SHIPMENT } })).status).toBe("captured");
  });

  it("AC7: dos capturas del mismo envío cobran una sola vez, también en paralelo", async () => {
    await seedHold();

    const results = await Promise.all([
      app.inject({ method: "POST", url: CAPTURE }),
      app.inject({ method: "POST", url: CAPTURE }),
    ]);
    const again = await app.inject({ method: "POST", url: CAPTURE });

    for (const r of [...results, again]) expect(r.statusCode).toBe(200);
    expect(await app.db.settlement.count()).toBe(1);
    // Las capturas en paralelo comparten la key de MP, que es la que impide el doble cobro;
    // la secuencial posterior ni siquiera le pega a MP.
    const callsBefore = mp.capturePayment.mock.calls.length;
    await app.inject({ method: "POST", url: CAPTURE });
    expect(mp.capturePayment.mock.calls.length).toBe(callsBefore);
  });

  it("AC8: si MP falla, la liquidación queda failed y el hold sigue authorized", async () => {
    await seedHold();
    mp.capturePayment.mockRejectedValue({ status: 500, message: "boom" });
    mp.getPayment.mockResolvedValue(payment({ status: "authorized", fee_details: [] }));

    const res = await app.inject({ method: "POST", url: CAPTURE });

    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("PAYMENT_PROVIDER_ERROR");
    expect((await app.db.settlement.findUniqueOrThrow({ where: { shipmentId: SHIPMENT } })).status).toBe("failed");
    expect((await app.db.hold.findFirstOrThrow({ where: { shipmentId: SHIPMENT } })).status).toBe("authorized");
  });

  it("un hold rechazado no se captura y no crea liquidación", async () => {
    await seedHold("rejected");

    const res = await app.inject({ method: "POST", url: CAPTURE });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("HOLD_NOT_CAPTURABLE");
    expect(await app.db.settlement.count()).toBe(0);
  });

  it("GET de la liquidación: 404 antes de capturar, 200 después", async () => {
    await seedHold();
    expect((await app.inject({ method: "GET", url: SETTLEMENT })).statusCode).toBe(404);

    await app.inject({ method: "POST", url: CAPTURE });
    const res = await app.inject({ method: "GET", url: SETTLEMENT });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "credited", netAmountArs: 809 });
  });
});
