import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../src/utils/token-cipher";

/**
 * MOVO-212, DoD: prueba de integración contra el SANDBOX REAL de Mercado Pago (hold
 * creado y CAPTURADO, con la liquidación persistida) con la configuración de SOLUCION-FINAL.
 *
 * No corre en CI ni sin credenciales: se saltea si falta el token del vendedor. Nada de
 * esto se versiona, todo entra por variables de entorno:
 *
 *   MP_SANDBOX_CARRIER_ACCESS_TOKEN   access_token `TEST-...` del Vendedor (OAuth, opción 2
 *                                     de docs/payments/mercadopago-spike/mp-spike-cli.js)
 *   MP_SANDBOX_CARRIER_PUBLIC_KEY     public_key del mismo Vendedor
 *   MP_SANDBOX_CARRIER_MP_USER_ID     user id de MP del Vendedor (opcional)
 *   MP_TEST_CARD_* / MP_TEST_PAYER_EMAIL / MP_TEST_PAYMENT_METHOD_ID   los del .env del spike
 *
 * Ejemplo (desde services/movo-svc-payments):
 *   node --env-file=../../docs/payments/mercadopago-spike/.env \
 *     ./node_modules/vitest/vitest.mjs run test/captures.sandbox.test.ts
 * con las tres MP_SANDBOX_CARRIER_* exportadas en la shell.
 */
const ACCESS_TOKEN = process.env.MP_SANDBOX_CARRIER_ACCESS_TOKEN;
const PUBLIC_KEY = process.env.MP_SANDBOX_CARRIER_PUBLIC_KEY;
const CONFIGURED = Boolean(ACCESS_TOKEN && PUBLIC_KEY && process.env.MP_TEST_CARD_NUMBER);

const ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

describe.skipIf(!CONFIGURED)("captura y split contra el sandbox real de Mercado Pago (MOVO-212)", () => {
  let app: FastifyInstance;
  const carrierId = randomUUID();
  const shipmentId = randomUUID();

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    // Cliente real del SDK (sin override): pega contra api.mercadopago.com.
    app = buildApp();
    await app.ready();

    expect(ACCESS_TOKEN!.startsWith("TEST-")).toBe(true);
    await createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).upsertLinked(
      carrierId,
      {
        // Propio de esta prueba: la base local puede tener esa cuenta de MP vinculada a
        // otro usuario (índice único parcial) y no se pisa. El cobro real va con el
        // access_token, no con este campo.
        mpUserId: `${process.env.MP_SANDBOX_CARRIER_MP_USER_ID ?? "sandbox"}-captures-sandbox-${carrierId}`,
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
  });

  afterAll(async () => {
    if (!app) return;
    await app.db.$executeRawUnsafe("DELETE FROM payments.settlements WHERE shipment_id = $1::uuid", shipmentId);
    await app.db.$executeRawUnsafe("DELETE FROM payments.holds WHERE shipment_id = $1::uuid", shipmentId);
    await app.db.$executeRawUnsafe("DELETE FROM payments.carrier_mp_accounts WHERE user_id = $1::uuid", carrierId);
    await app.close();
    delete process.env.MP_TOKEN_ENCRYPTION_KEY;
  });

  /** Lo que hace el mobile: tokenizar con la public_key del TRANSPORTISTA, sin Authorization. */
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

  it("captura un hold real y persiste la liquidación con los montos de fee_details", async () => {
    const payerEmail = process.env.MP_TEST_PAYER_EMAIL!;
    const created = await app.inject({
      method: "POST",
      url: "/internal/payments/holds",
      payload: {
        shipmentId,
        carrierId,
        cardToken: await tokenizeCard(),
        amountArs: 1150,
        payerEmail,
        paymentMethodId: process.env.MP_TEST_PAYMENT_METHOD_ID ?? "visa",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const hold = created.json();
    expect(hold.status).toBe("authorized");

    const captured = await app.inject({
      method: "POST",
      url: `/internal/payments/holds/by-shipment/${shipmentId}/capture`,
    });
    expect(captured.statusCode, captured.body).toBe(200);
    const settlement = captured.json().settlement;
    expect(settlement).toMatchObject({
      status: "credited",
      mpPaymentId: hold.mpPaymentId,
      grossAmountArs: 1150,
      commissionArs: 150,
    });

    // Los montos de la liquidación son los que MP informa tras capturar (SOLUCION-FINAL §3):
    // se contrastan con un GET directo al pago, no con lo que calcula el servicio.
    const direct = (await (
      await fetch(`https://api.mercadopago.com/v1/payments/${hold.mpPaymentId}`, {
        headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      })
    ).json()) as {
      status: string;
      fee_details: Array<{ type: string; amount: number }>;
      transaction_details: { net_received_amount: number };
    };
    expect(direct.status).toBe("approved");
    const mpFee = direct.fee_details.find((f) => f.type === "mercadopago_fee")?.amount;
    const appFee = direct.fee_details.find((f) => f.type === "application_fee")?.amount;
    expect(settlement.mpFeeArs).toBe(mpFee);
    expect(settlement.commissionArs).toBe(appFee);
    expect(settlement.netAmountArs).toBe(direct.transaction_details.net_received_amount);
    expect(Math.round((settlement.mpFeeArs + settlement.commissionArs + settlement.netAmountArs) * 100)).toBe(115000);

    const row = await app.db.settlement.findUniqueOrThrow({ where: { shipmentId } });
    expect(row.status).toBe("credited");
    expect((await app.db.hold.findFirstOrThrow({ where: { shipmentId } })).status).toBe("captured");

    // Idempotencia contra MP real: la segunda captura no cobra de nuevo.
    const again = await app.inject({
      method: "POST",
      url: `/internal/payments/holds/by-shipment/${shipmentId}/capture`,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().settlement.id).toBe(settlement.id);
  }, 90_000);
});
