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
        payerUserId: randomUUID(),
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
        payerUserId: randomUUID(),
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

/**
 * MOVO-282 (ADR-039), DoD: hold con una TARJETA GUARDADA contra el sandbox real. La tarjeta vive
 * en un customer de la cuenta de Movo S.A. (MOVO-100); el mobile pide a MP un token con `card_id` +
 * CVV y la `public_key` del Vendedor, y el hold se crea con `payer: { type: "customer", id }`.
 *
 * Se saltea sin credenciales. Necesita las del Vendedor (como arriba) más las de MOVO-100
 * (`cards.sandbox.test.ts`): MP_CLIENT_ID / MP_CLIENT_SECRET, MP_PUBLIC_KEY (`TEST-` con que se
 * tokeniza para GUARDAR la tarjeta), MP_SANDBOX_BUYER_EMAIL y la Visa 4075 5957 1648 3764 en
 * MP_TEST_CARD_NUMBER (guardar con las otras da 500 en el sandbox).
 *
 * Cómo simular resultados con una tarjeta GUARDADA (verificado el 14/10/2026): el resultado lo decide el
 * titular (APRO aprueba, SECU/FUND/EXPI rechazan, CONT queda en contingencia) y **hay que mandar la
 * identificación (`cardholder.identification`) al tokenizar para guardar**: sin ella, MP responde 500 al
 * guardar con cualquier titular que no sea APRO. El valor del CVV NO se valida en sandbox (un `999` se
 * autoriza igual), pero uno ausente/vacío (3031) o de largo inválido (3032) sí falla al crear el pago.
 * Cada caso guarda su propia tarjeta y la da de baja. Al terminar se borra el customer en MP y su
 * eliminación tarda ~1-2 minutos en reflejarse: una corrida inmediata puede fallar con `customer not found`.
 */
const SAVED_CARD_CONFIGURED = Boolean(
  CONFIGURED &&
    process.env.MP_CLIENT_ID &&
    process.env.MP_CLIENT_SECRET &&
    process.env.MP_PUBLIC_KEY?.startsWith("TEST-") &&
    process.env.MP_SANDBOX_BUYER_EMAIL
);

describe.skipIf(!SAVED_CARD_CONFIGURED)("hold con tarjeta guardada contra el sandbox real (MOVO-282)", () => {
  let app: FastifyInstance;
  const carrierId = randomUUID();
  const payerUserId = randomUUID();
  const shipmentIds: string[] = [];
  const headers = { "x-user-id": payerUserId };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    process.env.MP_TEST_MODE = "true";
    process.env.MP_TEST_PAYER_EMAILS = JSON.stringify({ [payerUserId]: process.env.MP_SANDBOX_BUYER_EMAIL });
    app = buildApp({ usersClient: { findAccountEmail: async () => null } });
    await app.ready();

    await createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).upsertLinked(
      carrierId,
      {
        mpUserId: `${process.env.MP_SANDBOX_CARRIER_MP_USER_ID ?? "sandbox"}-saved-card-${carrierId}`,
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
    for (const id of shipmentIds) {
      await app.db.$executeRawUnsafe("DELETE FROM payments.holds WHERE shipment_id = $1::uuid", id);
    }
    await app.db.$executeRawUnsafe("DELETE FROM payments.carrier_mp_accounts WHERE user_id = $1::uuid", carrierId);
    // Borra el customer del sandbox (y con él sus tarjetas) y las filas locales.
    await app.inject({ method: "DELETE", url: `/internal/payments/users/${payerUserId}/cards` });
    await app.close();
    delete process.env.MP_TOKEN_ENCRYPTION_KEY;
    delete process.env.MP_TEST_MODE;
    delete process.env.MP_TEST_PAYER_EMAILS;
  });

  /** Token para GUARDAR la tarjeta (la `public_key` de Movo, como `cards.sandbox.test.ts`). */
  async function tokenForSaving(holder: string): Promise<string> {
    const res = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${process.env.MP_PUBLIC_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        card_number: process.env.MP_TEST_CARD_NUMBER,
        security_code: process.env.MP_TEST_CARD_CVV ?? "123",
        expiration_month: Number(process.env.MP_TEST_CARD_EXP_MONTH ?? 11),
        expiration_year: Number(process.env.MP_TEST_CARD_EXP_YEAR ?? 2030),
        // Sin identificación MP responde 500 al guardar con cualquier titular que no sea APRO.
        cardholder: { name: holder, identification: { type: "DNI", number: "12345678" } },
      }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  /** Lo que hace el mobile al pagar: `card_id` + CVV con la `public_key` del TRANSPORTISTA. */
  async function tokenForPaying(mpCardId: string, cvv: string | null): Promise<string> {
    const res = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(PUBLIC_KEY!)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `null` = el emisor no escribió el CVV: se omite el campo.
      body: JSON.stringify({ card_id: mpCardId, ...(cvv === null ? {} : { security_code: cvv }) }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  /** Guarda la tarjeta con ese titular y devuelve su id interno y el de MP (solo para el token). */
  async function saveCard(holder: string): Promise<{ id: string; mpCardId: string }> {
    const created = await app.inject({
      method: "POST",
      url: "/payments/cards",
      headers,
      payload: { cardToken: await tokenForSaving(holder) },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { id } = created.json() as { id: string };
    const row = await app.db.savedCard.findUniqueOrThrow({ where: { id } });
    return { id, mpCardId: row.mpCardId };
  }

  async function holdWith(holder: string, cvv: string | null = process.env.MP_TEST_CARD_CVV ?? "123") {
    const card = await saveCard(holder);
    const shipmentId = randomUUID();
    shipmentIds.push(shipmentId);
    const res = await app.inject({
      method: "POST",
      url: "/internal/payments/holds",
      payload: {
        shipmentId,
        carrierId,
        cardToken: await tokenForPaying(card.mpCardId, cvv),
        amountArs: 1150,
        payerEmail: process.env.MP_SANDBOX_BUYER_EMAIL!,
        payerUserId,
        savedCardId: card.id,
      },
    });
    return { card, shipmentId, res };
  }

  const removeCard = (id: string) => app.inject({ method: "DELETE", url: `/payments/cards/${id}`, headers });

  it("reserva con payer: customer, el hold queda ligado a la tarjeta y se libera sin tocarla", async () => {
    const { card, shipmentId, res } = await holdWith("APRO");

    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ status: "authorized", statusDetail: "pending_capture", applicationFeeArs: 150 });
    expect(res.body).not.toContain(card.mpCardId);

    // Con el hold vivo la tarjeta no se puede borrar (MOVO-100, AC7).
    const blocked = await removeCard(card.id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("CARD_IN_USE");

    const released = await app.inject({
      method: "POST",
      url: `/internal/payments/holds/by-shipment/${shipmentId}/release`,
    });
    expect(released.statusCode, released.body).toBe(200);
    expect(released.json().status).toBe("cancelled");

    // Liberado el hold, la tarjeta sigue ahí y ahora sí se puede dar de baja.
    expect((await app.inject({ method: "GET", url: "/payments/cards", headers })).json()).toHaveLength(1);
    expect((await removeCard(card.id)).statusCode).toBe(204);
  }, 90_000);

  it("CVV incorrecto (titular SECU): rejected / invalid_data, no un error HTTP", async () => {
    const { card, res } = await holdWith("SECU");

    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      status: "rejected",
      statusDetail: "cc_rejected_bad_filled_security_code",
      failureReason: "invalid_data",
    });
    expect((await removeCard(card.id)).statusCode).toBe(204);
  }, 90_000);

  it("fondos insuficientes (titular FUND): rejected / insufficient_funds", async () => {
    const { card, res } = await holdWith("FUND");

    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ status: "rejected", failureReason: "insufficient_funds" });
    expect((await removeCard(card.id)).statusCode).toBe(204);
  }, 90_000);

  it("tarjeta guardada vencida (titular EXPI): rejected / card_rejected, no invalid_data", async () => {
    const { card, res } = await holdWith("EXPI");

    expect(res.statusCode, res.body).toBe(201);
    // MP responde cc_rejected_bad_filled_date; con tarjeta guardada el emisor no tipeó la fecha, así que
    // se clasifica como tarjeta rechazada (hay que probar con otra), no como un dato para revisar.
    expect(res.json()).toMatchObject({
      status: "rejected",
      statusDetail: "cc_rejected_bad_filled_date",
      failureReason: "card_rejected",
    });
    expect((await removeCard(card.id)).statusCode).toBe(204);
  }, 90_000);

  it.each([
    ["CVV ausente", null, "mp_error_3031"],
    ["CVV de largo inválido", "12", "mp_error_3032"],
  ])("%s: el pago se rechaza con 400 de MP y el hold queda rejected / invalid_data (no un 502 colgado)", async (_label, cvv, detail) => {
    const { card, res } = await holdWith("APRO", cvv);

    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ status: "rejected", statusDetail: detail, failureReason: "invalid_data" });
    expect((await removeCard(card.id)).statusCode).toBe(204);
  }, 90_000);

  it("en contingencia (titular CONT): queda in_process, un hold vivo", async () => {
    const { card, shipmentId, res } = await holdWith("CONT");

    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ status: "in_process", statusDetail: "pending_contingency" });
    // Vivo: la tarjeta no se puede borrar hasta liberarlo.
    expect((await removeCard(card.id)).statusCode).toBe(409);
    await app.inject({ method: "POST", url: `/internal/payments/holds/by-shipment/${shipmentId}/release` });
  }, 90_000);
});
