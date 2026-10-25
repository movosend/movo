import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

/**
 * MOVO-312, DoD: "Pagar mi saldo" contra el SANDBOX REAL de Mercado Pago (Checkout API: tarjeta guardada + CVV,
 * pago directo a la cuenta cobradora de Movo, vinculada por OAuth como la de un transportista).
 *
 * No corre en CI ni sin credenciales. Nada de esto se versiona, todo entra por entorno:
 *
 *   MP_CLIENT_ID / MP_CLIENT_SECRET   los de la app "movosend" (se usan para guardar la tarjeta en el customer de Movo S.A.)
 *   MP_TEST_MODE=true
 *   MP_SANDBOX_BUYER_EMAIL            email de la cuenta de prueba COMPRADOR
 *   MP_TEST_CARD_NUMBER / _CVV / _EXP_MONTH / _EXP_YEAR   Visa 4075 5957 1648 3764 (la del .env del spike da 500 al guardarla)
 *   MP_COLLECTOR_ACCESS_TOKEN / _PUBLIC_KEY / _MP_USER_ID   de la cuenta cobradora (DD-048): el token TEST- del OAuth
 *                                     de la cuenta de prueba Movo S.A. (son las mismas que `movo/dev/app-secrets`)
 *
 * El titular de la tarjeta decide el resultado en el sandbox: APRO aprueba, FUND = fondos insuficientes, SECU = CVV
 * inválido, OTHE = rechazo genérico. Para guardar una tarjeta con otro titular hay que tokenizar con `identification`.
 *
 * Ejemplo (desde services/movo-svc-payments):
 *   node --env-file=../../docs/payments/mercadopago-spike/.env ./node_modules/vitest/vitest.mjs run test/balance-payment.sandbox.test.ts
 */
const env = process.env;
const CONFIGURED = Boolean(
  env.MP_CLIENT_ID &&
    env.MP_CLIENT_SECRET &&
    env.MP_SANDBOX_BUYER_EMAIL &&
    env.MP_TEST_CARD_NUMBER &&
    env.MP_COLLECTOR_ACCESS_TOKEN &&
    env.MP_COLLECTOR_PUBLIC_KEY &&
    env.MP_COLLECTOR_MP_USER_ID
);

async function cardToken(publicKey: string, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${publicKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const fullCard = (holder: string) => ({
  card_number: env.MP_TEST_CARD_NUMBER,
  security_code: env.MP_TEST_CARD_CVV ?? "123",
  expiration_month: Number(env.MP_TEST_CARD_EXP_MONTH ?? 11),
  expiration_year: Number(env.MP_TEST_CARD_EXP_YEAR ?? 2030),
  cardholder: { name: holder, identification: { type: "DNI", number: "12345678" } },
});

describe.skipIf(!CONFIGURED)("pagar mi saldo contra el sandbox real de Mercado Pago (MOVO-312)", () => {
  let app: FastifyInstance;
  const userId = randomUUID();
  const headers = { "x-user-id": userId };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_TEST_MODE = "true";
    process.env.MP_PUBLIC_KEY = env.MP_COLLECTOR_PUBLIC_KEY;
    process.env.MP_TEST_PAYER_EMAILS = JSON.stringify({ [userId]: env.MP_SANDBOX_BUYER_EMAIL });
    app = buildApp({ usersClient: { findAccountEmail: async () => null } });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    if (!app) return;
    await app.inject({ method: "DELETE", url: `/internal/payments/users/${userId}/cards` });
    await app.close();
  });

  /** Guarda la tarjeta con ese titular (la vieja se borra: el titular queda fijo en la tarjeta de MP). */
  async function saveCard(holder: string): Promise<string> {
    for (const card of (await app.inject({ method: "GET", url: "/payments/cards", headers })).json()) {
      await app.inject({ method: "DELETE", url: `/payments/cards/${card.id}`, headers });
    }
    const created = await app.inject({
      method: "POST",
      url: "/payments/cards",
      headers,
      payload: { cardToken: await cardToken(env.MP_COLLECTOR_PUBLIC_KEY as string, fullCard(holder)), alias: holder },
    });
    expect(created.statusCode).toBeLessThan(300);
    return created.json().id;
  }

  /** Lo que haría el mobile: token con card_id + CVV y la public_key de la cobradora (de `pay-data`). */
  async function payToken(savedCardId: string): Promise<string> {
    const data = await app.inject({ method: "GET", url: "/payments/balance/pay-data", headers });
    expect(data.statusCode).toBe(200);
    const row = await app.db.savedCard.findUniqueOrThrow({ where: { id: savedCardId } });
    return cardToken(data.json().publicKey, { card_id: row.mpCardId, security_code: env.MP_TEST_CARD_CVV ?? "123" });
  }

  async function owe(amountArs: number) {
    await app.userLedger.createEntry(userId, { idempotencyKey: `penalty:${randomUUID()}`, type: "cancellation_penalty", amountArs });
  }

  const pay = (savedCardId: string, cardTokenValue: string, amountArs = 100) =>
    app.inject({
      method: "POST",
      url: "/payments/balance/pay",
      headers,
      payload: { amountArs, cardToken: cardTokenValue, savedCardId, paymentMethodId: "visa" },
    });

  const settled = async () =>
    (await app.db.userLedgerEntry.findMany({ where: { userId, type: "voluntary_payment", status: "settled" } })).length;

  it("1. APRO: aprueba, acredita UN voluntary_payment y baja el saldo", async () => {
    await owe(1000);
    const card = await saveCard("APRO");

    const res = await pay(card, await payToken(card), 100);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "approved", failureReason: null, balanceArs: 900 });
    expect(await settled()).toBe(1);
    const attempt = await app.db.balancePaymentAttempt.findFirstOrThrow({ where: { userId } });
    expect(attempt.mpPaymentId).not.toBeNull();

    // 7. El pago existe en MP con el token de la cobradora, con el monto y el external_reference del intento.
    const mp = await app.mercadoPago.getPayment(env.MP_COLLECTOR_ACCESS_TOKEN as string, attempt.mpPaymentId as string);
    expect(mp).toMatchObject({ status: "approved", transaction_amount: 100, external_reference: attempt.id });
  }, 60_000);

  it.each([
    ["FUND", "insufficient_funds"],
    ["SECU", "invalid_data"],
    // En el sandbox, OTHE con una tarjeta guardada vuelve como `cc_rejected_bad_filled_other` (dato mal cargado).
    ["OTHE", "invalid_data"],
  ])("rechazo con titular %s -> %s, sin tocar el saldo", async (holder, reason) => {
    await owe(500);
    const before = await settled();
    const card = await saveCard(holder);

    const res = await pay(card, await payToken(card), 50);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "rejected", failureReason: reason });
    expect(await settled()).toBe(before);
  }, 60_000);

  it("5. la misma idempotency key devuelve el mismo pago", async () => {
    const card = await saveCard("APRO");
    const token = await payToken(card);
    const body = {
      transaction_amount: 10,
      installments: 1,
      token,
      payment_method_id: "visa",
      description: "idempotencia",
      external_reference: randomUUID(),
      payer: { type: "customer", id: (await app.db.payerCustomer.findUniqueOrThrow({ where: { userId } })).mpCustomerId },
    };
    const key = `movo-312-sandbox-${randomUUID()}`;

    const first = await app.mercadoPago.createPayment(env.MP_COLLECTOR_ACCESS_TOKEN as string, body as never, key);
    const second = await app.mercadoPago.createPayment(env.MP_COLLECTOR_ACCESS_TOKEN as string, body as never, key);

    expect(second.id).toBe(first.id);
  }, 60_000);

  it("6. dos pedidos iguales a la vez cobran una sola vez", async () => {
    await owe(300);
    const before = await settled();
    const card = await saveCard("APRO");
    const token = await payToken(card);

    const [a, b] = await Promise.all([pay(card, token, 30), pay(card, token, 30)]);

    // MP puede responder 423 (2001, "ya enviaste el mismo pedido") a la segunda llamada simultánea: el servicio lo trata
    // como sin respuesta (502) y el intento queda abierto, sin cobrar dos veces.
    expect([a.statusCode, b.statusCode].every((s) => [200, 409, 502].includes(s))).toBe(true);
    expect([a.statusCode, b.statusCode]).toContain(200);
    expect(await settled()).toBe(before + 1);
  }, 60_000);
});
