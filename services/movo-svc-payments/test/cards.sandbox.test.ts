import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

/**
 * MOVO-100, DoD: guardar una tarjeta, listarla y borrarla contra el SANDBOX REAL de
 * Mercado Pago (Customers & Cards con el token TEST- de Movo S.A.).
 *
 * No corre en CI ni sin credenciales. Nada de esto se versiona, todo entra por entorno:
 *
 *   MP_CLIENT_ID / MP_CLIENT_SECRET   los de la app "movosend" (creada logueado como Movo S.A.)
 *   MP_PUBLIC_KEY                     la public_key TEST- de Movo S.A. (la APP_USR- da 404)
 *   MP_TEST_MODE=true
 *   MP_SANDBOX_BUYER_EMAIL            email de una cuenta de prueba COMPRADOR (sino 225)
 *   MP_TEST_CARD_NUMBER / MP_TEST_CARD_CVV / MP_TEST_CARD_EXP_MONTH / MP_TEST_CARD_EXP_YEAR
 *   MP_TEST_CARD_HOLDER               los del .env del spike (docs/payments/mercadopago-spike)
 *
 * TARJETA: en el sandbox, guardar una tarjeta en un customer (`POST /v1/customers/{id}/cards`) da
 * `500 internal_server_error` con la Visa 4509 9535 6623 3704, la Mastercard 5031 7557 3453 0604 y la
 * del `.env` del spike (verificado el 13/10/2026, también con curl directo); con la Visa
 * 4075 5957 1648 3764 (CVV 123) responde 201. Usar esa en MP_TEST_CARD_NUMBER.
 * PUBLIC_KEY: alcanza cualquier `TEST-` de un Vendedor de prueba vinculado (no hace falta la de
 * Movo S.A.: la consola de la app solo muestra credenciales de producción).
 *
 * El `card_token` se genera acá contra `POST /v1/card_tokens?public_key=` como lo haría el
 * mobile. El email del customer se fuerza con MP_TEST_PAYER_EMAILS.
 *
 * Ejemplo (desde services/movo-svc-payments):
 *   node --env-file=../../docs/payments/mercadopago-spike/.env \
 *     ./node_modules/vitest/vitest.mjs run test/cards.sandbox.test.ts
 */
const {
  MP_CLIENT_ID,
  MP_CLIENT_SECRET,
  MP_PUBLIC_KEY,
  MP_SANDBOX_BUYER_EMAIL,
  MP_TEST_CARD_NUMBER,
  MP_TEST_CARD_CVV,
  MP_TEST_CARD_EXP_MONTH,
  MP_TEST_CARD_EXP_YEAR,
  MP_TEST_CARD_HOLDER,
} = process.env;
const CONFIGURED = Boolean(
  MP_CLIENT_ID && MP_CLIENT_SECRET && MP_PUBLIC_KEY?.startsWith("TEST-") && MP_SANDBOX_BUYER_EMAIL && MP_TEST_CARD_NUMBER
);

async function tokenizeCard(): Promise<string> {
  const response = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${MP_PUBLIC_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      card_number: MP_TEST_CARD_NUMBER,
      security_code: MP_TEST_CARD_CVV ?? "123",
      expiration_month: Number(MP_TEST_CARD_EXP_MONTH ?? 11),
      expiration_year: Number(MP_TEST_CARD_EXP_YEAR ?? 2030),
      cardholder: { name: MP_TEST_CARD_HOLDER ?? "APRO" },
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

describe.skipIf(!CONFIGURED)("tarjetas guardadas contra el sandbox real de Mercado Pago (MOVO-100)", () => {
  let app: FastifyInstance;
  const userId = randomUUID();
  const headers = { "x-user-id": userId };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_TEST_MODE = "true";
    process.env.MP_TEST_PAYER_EMAILS = JSON.stringify({ [userId]: MP_SANDBOX_BUYER_EMAIL });
    // Clientes reales (sin override); solo el email sale del mapa de sandbox, no de svc-users.
    app = buildApp({ usersClient: { findAccountEmail: async () => null } });
    await app.ready();
  });

  afterAll(async () => {
    if (!app) return;
    // Limpia el customer del sandbox (borra también sus tarjetas) y las filas locales.
    await app.inject({ method: "DELETE", url: `/internal/payments/users/${userId}/cards` });
    await app.close();
  });

  it("guarda la tarjeta, la lista y la borra", async () => {
    const checkout = await app.inject({ method: "GET", url: "/payments/cards/checkout-data", headers });
    expect(checkout.json().publicKey).toBe(MP_PUBLIC_KEY);

    const created = await app.inject({
      method: "POST",
      url: "/payments/cards",
      headers,
      payload: { cardToken: await tokenizeCard(), alias: "Sandbox" },
    });
    expect(created.statusCode).toBe(201);
    const card = created.json();
    expect(card).toMatchObject({ alias: "Sandbox", isDefault: true });
    expect(card.last4).toBe((MP_TEST_CARD_NUMBER as string).slice(-4));

    const listed = await app.inject({ method: "GET", url: "/payments/cards", headers });
    expect(listed.json().map((c: { id: string }) => c.id)).toEqual([card.id]);

    // Un alta repetida de la misma tarjeta no suma otra fila.
    const again = await app.inject({
      method: "POST",
      url: "/payments/cards",
      headers,
      payload: { cardToken: await tokenizeCard() },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(card.id);

    const removed = await app.inject({ method: "DELETE", url: `/payments/cards/${card.id}`, headers });
    expect(removed.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/payments/cards", headers })).json()).toEqual([]);
  });
});
