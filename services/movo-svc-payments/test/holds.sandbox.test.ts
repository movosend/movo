import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../src/utils/token-cipher";

/**
 * MOVO-209, DoD: prueba de integración contra el SANDBOX REAL de Mercado Pago (hold
 * creado, consultado y liberado) con la configuración de SOLUCION-FINAL.
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
 *     ./node_modules/vitest/vitest.mjs run test/holds.sandbox.test.ts
 * con las tres MP_SANDBOX_CARRIER_* exportadas en la shell.
 */
const ACCESS_TOKEN = process.env.MP_SANDBOX_CARRIER_ACCESS_TOKEN;
const PUBLIC_KEY = process.env.MP_SANDBOX_CARRIER_PUBLIC_KEY;
const CONFIGURED = Boolean(ACCESS_TOKEN && PUBLIC_KEY && process.env.MP_TEST_CARD_NUMBER);

const ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

describe.skipIf(!CONFIGURED)("hold contra el sandbox real de Mercado Pago (MOVO-209)", () => {
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
        mpUserId: `${process.env.MP_SANDBOX_CARRIER_MP_USER_ID ?? "sandbox"}-holds-sandbox-${carrierId}`,
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

  it("crea, consulta y libera un hold real (capture:false + application_fee)", async () => {
    const payerEmail = process.env.MP_TEST_PAYER_EMAIL!;

    const checkout = await app.inject({
      method: "POST",
      url: "/internal/payments/holds/checkout-data",
      payload: { shipmentId, carrierId, amountArs: 1150, payerEmail },
    });
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json()).toMatchObject({ publicKey: PUBLIC_KEY, amountArs: 1150, applicationFeeArs: 150 });

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
    // Reserva sin cobrar: authorized / pending_capture (SOLUCION-FINAL §3, paso 3).
    expect(hold).toMatchObject({
      status: "authorized",
      statusDetail: "pending_capture",
      amountArs: 1150,
      applicationFeeArs: 150,
      attempt: 1,
    });
    expect(hold.mpPaymentId).toMatch(/^\d+$/);
    expect(new Date(hold.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Un reintento no crea un segundo pago en MP.
    const replay = await app.inject({
      method: "POST",
      url: "/internal/payments/holds",
      payload: {
        shipmentId,
        carrierId,
        cardToken: "token-que-no-se-usa",
        amountArs: 1150,
        payerEmail,
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().mpPaymentId).toBe(hold.mpPaymentId);

    // La recuperación de un intento en `creating` depende de poder encontrar el pago por
    // `external_reference` (el id del envío). MP indexa con un pequeño retraso.
    let found: Array<{ id?: string | number; status?: string }> = [];
    for (let i = 0; i < 10 && found.length === 0; i += 1) {
      found = await app.mercadoPago.searchPaymentsByExternalReference(ACCESS_TOKEN!, shipmentId);
      if (found.length === 0) await new Promise((r) => setTimeout(r, 1500));
    }
    expect(found.map((p) => String(p.id))).toContain(hold.mpPaymentId);
    expect(found.find((p) => String(p.id) === hold.mpPaymentId)?.status).toBe("authorized");

    // Consulta sincronizada contra MP.
    const synced = await app.inject({
      method: "GET",
      url: `/internal/payments/holds/by-shipment/${shipmentId}?sync=true`,
    });
    expect(synced.statusCode).toBe(200);
    expect(synced.json()).toMatchObject({ status: "authorized", mpPaymentId: hold.mpPaymentId });

    // Liberación sin captura (SOLUCION-FINAL §3, paso 4b).
    const released = await app.inject({
      method: "POST",
      url: `/internal/payments/holds/by-shipment/${shipmentId}/release`,
    });
    expect(released.statusCode, released.body).toBe(200);
    expect(released.json()).toMatchObject({ status: "cancelled", mpPaymentId: hold.mpPaymentId });

    // MP confirma la cancelación: el estado real lo trae un GET directo al pago.
    const direct = await fetch(`https://api.mercadopago.com/v1/payments/${hold.mpPaymentId}`, {
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    expect(((await direct.json()) as { status: string }).status).toBe("cancelled");
  }, 60_000);
});
