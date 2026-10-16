import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../src/utils/token-cipher";

/**
 * MOVO-212, DoD: prueba de integración contra el SANDBOX REAL de Mercado Pago (hold
 * creado y CAPTURADO, con la liquidación persistida) con la configuración de SOLUCION-FINAL.
 * MOVO-306 suma la captura parcial por penalidad de cancelación y el rechazo previo a MP de
 * una penalidad que no supera el `application_fee` (spike MOVO-305).
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
 *     ../../node_modules/vitest/vitest.mjs run test/captures.sandbox.test.ts
 * con las tres MP_SANDBOX_CARRIER_* exportadas en la shell.
 */
const ACCESS_TOKEN = process.env.MP_SANDBOX_CARRIER_ACCESS_TOKEN;
const PUBLIC_KEY = process.env.MP_SANDBOX_CARRIER_PUBLIC_KEY;
const CONFIGURED = Boolean(ACCESS_TOKEN && PUBLIC_KEY && process.env.MP_TEST_CARD_NUMBER);

const ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

describe.skipIf(!CONFIGURED)("captura y split contra el sandbox real de Mercado Pago (MOVO-212/306)", () => {
  let app: FastifyInstance;
  const carrierId = randomUUID();
  const shipmentId = randomUUID();
  const penaltyShipmentId = randomUUID();
  const planBShipmentId = randomUUID();

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
    for (const id of [shipmentId, penaltyShipmentId, planBShipmentId]) {
      await app.db.$executeRawUnsafe("DELETE FROM payments.settlements WHERE shipment_id = $1::uuid", id);
      await app.db.$executeRawUnsafe("DELETE FROM payments.holds WHERE shipment_id = $1::uuid", id);
    }
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

  /** Hold real de $1.150 (comisión $150) para el envío, ya `authorized`. */
  async function createHold(forShipment: string): Promise<{ mpPaymentId: string }> {
    const created = await app.inject({
      method: "POST",
      url: "/internal/payments/holds",
      payload: {
        shipmentId: forShipment,
        carrierId,
        cardToken: await tokenizeCard(),
        amountArs: 1150,
        payerEmail: process.env.MP_TEST_PAYER_EMAIL!,
        payerUserId: randomUUID(),
        paymentMethodId: process.env.MP_TEST_PAYMENT_METHOD_ID ?? "visa",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const hold = created.json();
    expect(hold.status).toBe("authorized");
    return hold;
  }

  /** El pago tal como lo ve MP: la liquidación se contrasta con lo que informa, no con lo que calcula el servicio. */
  async function getMpPayment(mpPaymentId: string) {
    return (await (
      await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
        headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      })
    ).json()) as {
      status: string;
      transaction_amount: number;
      fee_details: Array<{ type: string; amount: number }>;
      transaction_details: { net_received_amount: number };
    };
  }

  it("captura un hold real y persiste la liquidación con los montos de fee_details", async () => {
    const hold = await createHold(shipmentId);

    const captured = await app.inject({
      method: "POST",
      url: `/internal/payments/holds/by-shipment/${shipmentId}/capture`,
    });
    expect(captured.statusCode, captured.body).toBe(200);
    const settlement = captured.json().settlement;
    expect(settlement).toMatchObject({
      status: "credited",
      kind: "delivery",
      mpPaymentId: hold.mpPaymentId,
      grossAmountArs: 1150,
      commissionArs: 150,
    });

    // Los montos de la liquidación son los que MP informa tras capturar (SOLUCION-FINAL §3):
    // se contrastan con un GET directo al pago, no con lo que calcula el servicio.
    const direct = await getMpPayment(hold.mpPaymentId);
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

  it("MOVO-306: penalidad del 25 %: captura parcial, MP libera el resto y cobra la comisión entera", async () => {
    const hold = await createHold(penaltyShipmentId);
    const capture = () =>
      app.inject({
        method: "POST",
        url: `/internal/payments/holds/by-shipment/${penaltyShipmentId}/capture`,
        payload: { kind: "cancellation_penalty", amountArs: 287.5 },
      });

    const captured = await capture();
    expect(captured.statusCode, captured.body).toBe(200);
    const settlement = captured.json().settlement;
    expect(settlement).toMatchObject({
      status: "credited",
      kind: "cancellation_penalty",
      grossAmountArs: 287.5,
      // Spike MOVO-305: el application_fee no se prorratea.
      commissionArs: 150,
    });

    const direct = await getMpPayment(hold.mpPaymentId);
    expect(direct.status).toBe("approved");
    expect(direct.transaction_amount).toBe(287.5);
    expect(settlement.mpFeeArs).toBe(direct.fee_details.find((f) => f.type === "mercadopago_fee")?.amount);
    expect(settlement.commissionArs).toBe(direct.fee_details.find((f) => f.type === "application_fee")?.amount);
    expect(settlement.netAmountArs).toBe(direct.transaction_details.net_received_amount);
    expect(Math.round((settlement.mpFeeArs + settlement.commissionArs + settlement.netAmountArs) * 100)).toBe(28750);
    expect((await app.db.hold.findFirstOrThrow({ where: { shipmentId: penaltyShipmentId } })).status).toBe("captured");

    // Idempotencia contra MP real: el mismo pedido no vuelve a capturar.
    const again = await capture();
    expect(again.statusCode).toBe(200);
    expect(again.json().settlement.id).toBe(settlement.id);
  }, 90_000);

  it("MOVO-306: penalidad que no supera la comisión: 422 sin tocar MP, y el plan B libera el hold", async () => {
    const hold = await createHold(planBShipmentId);

    const rejected = await app.inject({
      method: "POST",
      url: `/internal/payments/holds/by-shipment/${planBShipmentId}/capture`,
      payload: { kind: "cancellation_penalty", amountArs: 100 },
    });
    expect(rejected.statusCode, rejected.body).toBe(422);
    expect(rejected.json().error.code).toBe("CAPTURE_BELOW_APPLICATION_FEE");
    expect((await getMpPayment(hold.mpPaymentId)).status).toBe("authorized");

    // Plan B (MOVO-307): se libera el hold completo y la penalidad pasa a deuda (MOVO-309).
    const released = await app.inject({
      method: "POST",
      url: `/internal/payments/holds/by-shipment/${planBShipmentId}/release`,
    });
    expect(released.statusCode, released.body).toBe(200);
    expect((await getMpPayment(hold.mpPaymentId)).status).toBe("cancelled");
  }, 90_000);
});
