import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../src/utils/token-cipher";

/**
 * MOVO-311, DoD: hold con `application_fee` y monto aumentados por la deuda de la cuenta corriente,
 * contra el SANDBOX REAL de Mercado Pago, capturado y con la deuda asentada. Mismas variables que
 * `captures.sandbox.test.ts` (se saltea sin ellas, no corre en CI):
 *
 *   node --env-file=../../docs/payments/mercadopago-spike/.env \
 *     ./node_modules/vitest/vitest.mjs run test/debt-collection.sandbox.test.ts
 *
 * con `MP_SANDBOX_CARRIER_ACCESS_TOKEN`/`_PUBLIC_KEY` (y opcional `_MP_USER_ID`) exportadas en la shell.
 *
 * Los movimientos del ledger no se borran al terminar (la tabla es de solo inserción y la FK a holds es
 * RESTRICT): quedan con usuarios y envío aleatorios, sin efecto sobre otros tests.
 */
const ACCESS_TOKEN = process.env.MP_SANDBOX_CARRIER_ACCESS_TOKEN;
const PUBLIC_KEY = process.env.MP_SANDBOX_CARRIER_PUBLIC_KEY;
const CONFIGURED = Boolean(ACCESS_TOKEN && PUBLIC_KEY && process.env.MP_TEST_CARD_NUMBER);

const ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

describe.skipIf(!CONFIGURED)("deuda cobrada en el hold contra el sandbox real de Mercado Pago (MOVO-311)", () => {
  let app: FastifyInstance;
  const carrierId = randomUUID();
  const payerId = randomUUID();
  const shipmentId = randomUUID();

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    app = buildApp();
    await app.ready();

    await createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).upsertLinked(
      carrierId,
      {
        mpUserId: `${process.env.MP_SANDBOX_CARRIER_MP_USER_ID ?? "sandbox"}-debt-sandbox-${carrierId}`,
        email: null,
        nickname: null,
        accessToken: ACCESS_TOKEN!,
        refreshToken: "TG-no-usado-en-esta-prueba",
        publicKey: PUBLIC_KEY!,
        scope: "offline_access",
        tokenExpiresAt: new Date(Date.now() + 86_400_000),
      },
      new Date()
    );
    for (const [userId, amountArs] of [
      [carrierId, 100],
      [payerId, 200],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url: `/internal/payments/users/${userId}/ledger-entries`,
        payload: { idempotencyKey: `sandbox-debt:${userId}`, type: "cancellation_penalty", amountArs },
      });
      expect(res.statusCode).toBe(201);
    }
  });

  afterAll(async () => {
    if (!app) return;
    await app.db.$executeRawUnsafe("DELETE FROM payments.carrier_mp_accounts WHERE user_id = $1::uuid", carrierId);
    await app.close();
    delete process.env.MP_TOKEN_ENCRYPTION_KEY;
  });

  async function tokenizeCard(): Promise<string> {
    const res = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(PUBLIC_KEY!)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        card_number: process.env.MP_TEST_CARD_NUMBER,
        security_code: process.env.MP_TEST_CARD_CVV,
        expiration_month: Number(process.env.MP_TEST_CARD_EXP_MONTH),
        expiration_year: Number(process.env.MP_TEST_CARD_EXP_YEAR),
        cardholder: {
          name: process.env.MP_TEST_CARD_HOLDER_NAME ?? "APRO",
          identification: { type: "DNI", number: "12345678" },
        },
      }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  it("MP acepta el monto y el fee aumentados, retiene el fee completo y la deuda queda saldada", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/internal/payments/holds",
      payload: {
        shipmentId,
        carrierId,
        cardToken: await tokenizeCard(),
        amountArs: 1150,
        payerEmail: process.env.MP_TEST_PAYER_EMAIL!,
        payerUserId: payerId,
        paymentMethodId: process.env.MP_TEST_PAYMENT_METHOD_ID ?? "visa",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const hold = created.json();
    // Precio 1150 + recargo 200; fee = comisión 150 + descuento 100 + (200 − 4,99% de MP).
    expect(hold).toMatchObject({ status: "authorized", amountArs: 1350, applicationFeeArs: 440.02 });

    const captured = await app.inject({ method: "POST", url: `/internal/payments/holds/by-shipment/${shipmentId}/capture` });
    expect(captured.statusCode, captured.body).toBe(200);
    expect(captured.json().settlement).toMatchObject({
      status: "credited",
      grossAmountArs: 1350,
      commissionArs: 150,
      debtOffsetArs: 100,
      debtSurchargeArs: 200,
    });

    const direct = (await (
      await fetch(`https://api.mercadopago.com/v1/payments/${hold.mpPaymentId}`, {
        headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      })
    ).json()) as { status: string; transaction_amount: number; fee_details: Array<{ type: string; amount: number }> };
    expect(direct.status).toBe("approved");
    expect(direct.transaction_amount).toBe(1350);
    expect(direct.fee_details.find((f) => f.type === "application_fee")?.amount).toBe(440.02);

    for (const userId of [carrierId, payerId]) {
      const balance = await app.inject({ method: "GET", url: `/internal/payments/users/${userId}/balance` });
      expect(balance.json().balanceArs).toBe(0);
    }
  }, 90_000);
});
