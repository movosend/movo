import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { LIVE_HOLD_STATUSES } from "@movo/shared";
import type { MercadoPagoClient, PaymentResponse } from "../src/adapters/mercadopago-client";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../src/utils/token-cipher";

// Integración contra Postgres y Redis reales (convención del repo); solo se reemplaza el
// cliente de MP para no pegarle al sandbox. El hold creado, consultado y liberado contra
// el sandbox real es la DoD manual del ticket (ver CLAUDE.md del servicio).

const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIPMENT_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
// MOVO-282: el emisor (dueño de la tarjeta guardada) y otro usuario.
const PAYER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const STRANGER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
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
    searchPaymentsByExternalReference: vi.fn(async () => []),
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
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.holds, payments.carrier_mp_accounts, payments.saved_cards, payments.payer_customers CASCADE");
    createCount = 0;
    for (const fn of [mp.createPayment, mp.getPayment, mp.cancelPayment]) fn.mockClear();
    mp.createPayment.mockImplementation(async () => payment({ id: 1_000_000 + ++createCount }));
    mp.getPayment.mockImplementation(async () => payment());
    mp.cancelPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "by_collector" }));
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

  const body = (overrides: Record<string, unknown> = {}) => ({
    shipmentId: SHIPMENT,
    carrierId: CARRIER,
    cardToken: "card-token-1",
    amountArs: 1150,
    payerEmail: "comprador@example.com",
    payerUserId: PAYER,
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
      baseAmountArs: 1150,
      debtOffsetArs: 0,
      debtSurchargeArs: 0,
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
      collectorId: "1000000001",
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
           application_fee_ars, base_amount_ars, commission_ars, status, updated_at)
         VALUES ('${SHIPMENT}', 2, '${CARRIER}', '1', 100, 10, 100, 10, 'authorized', now())`
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

  it("rechaza una liberación retrasada de otro transportista sin tocar el hold", async () => {
    await create();
    const wrongCarrier = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const response = await app.inject({
      method: "POST",
      url: `${BASE}/by-shipment/${SHIPMENT}/release?expectedCarrierId=${wrongCarrier}`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("HOLD_CONFLICT");
    expect(mp.cancelPayment).not.toHaveBeenCalled();
    expect((await app.inject({ method: "GET", url: `${BASE}/by-shipment/${SHIPMENT}` })).json().status)
      .toBe("authorized");
  });

  it("rechaza una liberación retrasada del mismo transportista si ya hay otro intento", async () => {
    const previousId = (await create()).json().id as string;
    expect((await app.inject({ method: "POST", url: `${BASE}/by-shipment/${SHIPMENT}/release` })).statusCode)
      .toBe(200);
    const next = await create({ cardToken: "otro-token" });
    expect(next.statusCode).toBe(201);
    const response = await app.inject({
      method: "POST",
      url: `${BASE}/by-shipment/${SHIPMENT}/release?expectedCarrierId=${CARRIER}&expectedHoldId=${previousId}`,
    });
    expect(response.statusCode).toBe(409);
    expect(next.json().id).not.toBe(previousId);
    expect(mp.cancelPayment).toHaveBeenCalledTimes(1);
  });

  it("el índice único parcial de la base lista exactamente los estados vivos de @movo/shared (review, punto 7)", async () => {
    const [{ indexdef }] = await app.db.$queryRawUnsafe<Array<{ indexdef: string }>>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'payments' AND indexname = 'holds_shipment_id_live_key'"
    );
    const predicate = indexdef.slice(indexdef.indexOf("WHERE"));
    const inIndex = [...predicate.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inIndex).toEqual([...LIVE_HOLD_STATUSES].sort());
  });

  it("un reintento de un hold vigente devuelve el hold aunque el transportista se haya desvinculado (punto 3)", async () => {
    const first = await create();
    expect(first.statusCode).toBe(201);
    await createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).unlink(CARRIER, new Date());

    const retry = await create();
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(first.json().id);

    // En cambio, un hold nuevo sí exige la cuenta vinculada.
    const checkout = await app.inject({
      method: "POST",
      url: `${BASE}/checkout-data`,
      payload: { shipmentId: SHIPMENT, carrierId: CARRIER, amountArs: 1150, payerEmail: "e@x.com" },
    });
    expect(checkout.statusCode).toBe(409);
  });

  it("no libera un hold si el transportista ya no tiene credenciales: 409 y el hold sigue vivo (punto 4)", async () => {
    await create();
    await createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).unlink(CARRIER, new Date());

    const released = await app.inject({ method: "POST", url: `${BASE}/by-shipment/${SHIPMENT}/release` });
    expect(released.statusCode).toBe(409);
    expect(released.json().error.code).toBe("CARRIER_MP_ACCOUNT_NOT_LINKED");
    const stored = await app.inject({ method: "GET", url: `${BASE}/by-shipment/${SHIPMENT}` });
    expect(stored.json().status).toBe("authorized");
  });

  it("rechaza con 400 un monto con más de dos decimales en vez de redondearlo (punto 8)", async () => {
    const tooPrecise = await create({ amountArs: 1150.005 });
    expect(tooPrecise.statusCode).toBe(400);
    expect(tooPrecise.json().error.code).toBe("VALIDATION_FAILED");
    const belowMinimum = await create({ amountArs: 0.004 });
    expect(belowMinimum.statusCode).toBe(400);
    expect(mp.createPayment).not.toHaveBeenCalled();
  });

  describe("con tarjeta guardada (MOVO-282, DD-039)", () => {
    /** Una tarjeta viva del emisor en su customer de la cuenta de Movo. */
    async function seedCard(userId = PAYER, overrides: { deletedAt?: Date } = {}) {
      await app.db.payerCustomer.upsert({
        where: { userId },
        create: { userId, mpCustomerId: `mp-customer-${userId.slice(0, 4)}` },
        update: {},
      });
      return app.db.savedCard.create({
        data: { userId, mpCardId: "mp-card-secret", brand: "visa", last4: "3764", expMonth: 11, expYear: 2030, ...overrides },
      });
    }

    it("AC1/AC3: el pagador es el customer de la tarjeta y el hold guarda saved_card_id", async () => {
      const card = await seedCard();

      const res = await create({ savedCardId: card.id });

      expect(res.statusCode).toBe(201);
      const [, mpBody] = mp.createPayment.mock.calls[0] as unknown as [string, Record<string, unknown>, string];
      expect(mpBody.payer).toEqual({ type: "customer", id: `mp-customer-${PAYER.slice(0, 4)}` });
      expect(mpBody.token).toBe("card-token-1");
      const [row] = await app.db.$queryRawUnsafe<Array<{ saved_card_id: string }>>(
        "SELECT saved_card_id::text AS saved_card_id FROM payments.holds"
      );
      expect(row.saved_card_id).toBe(card.id);
    });

    it("AC2: la respuesta no expone customer_id ni card_id de MP", async () => {
      const card = await seedCard();
      const res = await create({ savedCardId: card.id });
      const raw = res.body;
      expect(raw).not.toContain("mp-card-secret");
      expect(raw).not.toContain("mp-customer-");
      expect(res.json()).not.toHaveProperty("savedCardId");
    });

    it("sin savedCardId el pagador sigue siendo el email y saved_card_id queda null", async () => {
      const res = await create();
      expect(res.statusCode).toBe(201);
      const [, mpBody] = mp.createPayment.mock.calls[0] as unknown as [string, Record<string, unknown>, string];
      expect(mpBody.payer).toEqual({ email: "comprador@example.com" });
      const [row] = await app.db.$queryRawUnsafe<Array<{ saved_card_id: string | null }>>(
        "SELECT saved_card_id::text AS saved_card_id FROM payments.holds"
      );
      expect(row.saved_card_id).toBeNull();
    });

    it("AC2: la tarjeta de otro usuario, dada de baja o inexistente responden 404 y no crean nada", async () => {
      const mine = await seedCard();
      const theirs = await seedCard(STRANGER);
      const deleted = await seedCard(PAYER, { deletedAt: new Date() });

      for (const savedCardId of [theirs.id, deleted.id, "00000000-0000-4000-8000-0000000000aa"]) {
        const res = await create({ savedCardId });
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("SAVED_CARD_NOT_FOUND");
      }
      // La de otro usuario tampoco sirve aunque el `payerUserId` sea el de su dueño con otro emisor.
      expect((await create({ savedCardId: mine.id, payerUserId: STRANGER })).statusCode).toBe(404);

      expect(mp.createPayment).not.toHaveBeenCalled();
      expect(await app.db.hold.count()).toBe(0);
    });

    it("AC3: con un hold vivo creado con la tarjeta, borrarla responde 409 CARD_IN_USE", async () => {
      const card = await seedCard();
      expect((await create({ savedCardId: card.id })).statusCode).toBe(201);

      const res = await app.inject({
        method: "DELETE",
        url: `/payments/cards/${card.id}`,
        headers: { "x-user-id": PAYER },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("CARD_IN_USE");
      expect(await app.db.savedCard.count({ where: { id: card.id, deletedAt: null } })).toBe(1);
    });

    it("AC4: un reintento con otra tarjeta guardada sobre un intento sin respuesta no reusa la key", async () => {
      const first = await seedCard();
      const second = await app.db.savedCard.create({
        data: { userId: PAYER, mpCardId: "mp-card-2", brand: "master", last4: "1111", expMonth: 5, expYear: 2031 },
      });
      mp.createPayment.mockRejectedValueOnce(new Error("The operation was aborted"));
      expect((await create({ savedCardId: first.id })).statusCode).toBe(502);

      const res = await create({ savedCardId: second.id });

      expect(res.statusCode).toBe(201);
      expect(res.json().attempt).toBe(2);
      expect((mp.createPayment.mock.calls[1] as unknown as [string, unknown, string])[2]).toBe(`movo-hold-${SHIPMENT}-2`);
    });

    it("AC6: un CVV incorrecto vuelve como 201 rejected/invalid_data, no como error HTTP", async () => {
      const card = await seedCard();
      mp.createPayment.mockResolvedValueOnce(
        payment({ status: "rejected", status_detail: "cc_rejected_bad_filled_security_code" })
      );

      const res = await create({ savedCardId: card.id });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ status: "rejected", failureReason: "invalid_data" });
    });

    it("AC8: liberar el hold cancela con el token del transportista y no toca la tarjeta", async () => {
      const card = await seedCard();
      await create({ savedCardId: card.id });

      const res = await app.inject({ method: "POST", url: `${BASE}/by-shipment/${SHIPMENT}/release` });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("cancelled");
      expect(mp.cancelPayment.mock.calls[0][0]).toBe("TEST-access-secret");
      expect(await app.db.savedCard.count({ where: { id: card.id, deletedAt: null } })).toBe(1);
    });
  });

  describe("pagador y tarjeta para el historial (MOVO-302)", () => {
    type HistoryRow = { payer_id: string | null; card_last4: string | null; card_brand: string | null };
    const historyRow = async () => {
      const rows = await app.db.$queryRawUnsafe<HistoryRow[]>(
        "SELECT payer_id::text AS payer_id, card_last4, card_brand FROM payments.holds ORDER BY attempt DESC LIMIT 1"
      );
      return rows[0];
    };
    const withCard = (last4: string, brand = "visa") =>
      payment({ payment_method_id: brand, card: { last_four_digits: last4 } } as Partial<PaymentResponse>);

    it("AC3/AC4: persiste el emisor y la tarjeta que informa MP, y no los expone en la respuesta", async () => {
      mp.createPayment.mockImplementation(async () => ({ ...withCard("4242"), id: 1_000_001 }) as PaymentResponse);

      const res = await create();

      expect(res.statusCode).toBe(201);
      expect(await historyRow()).toEqual({ payer_id: PAYER, card_last4: "4242", card_brand: "visa" });
      for (const key of ["payerId", "payerUserId", "cardLast4", "cardBrand"]) {
        expect(res.json()).not.toHaveProperty(key);
      }
    });

    it("AC4: si MP no informa la tarjeta quedan en null (el emisor sí se guarda)", async () => {
      await create();
      expect(await historyRow()).toEqual({ payer_id: PAYER, card_last4: null, card_brand: null });
    });

    it("AC4: ?sync=true completa la tarjeta que faltaba y una consulta sin tarjeta no la borra", async () => {
      await create();
      mp.getPayment.mockImplementationOnce(async () => withCard("1881", "master") as PaymentResponse);
      const first = await app.inject({ method: "GET", url: `${BASE}/by-shipment/${SHIPMENT}?sync=true` });
      expect(first.statusCode).toBe(200);
      expect(await historyRow()).toMatchObject({ card_last4: "1881", card_brand: "master" });

      mp.getPayment.mockImplementationOnce(async () => payment());
      await app.inject({ method: "GET", url: `${BASE}/by-shipment/${SHIPMENT}?sync=true` });
      expect(await historyRow()).toMatchObject({ card_last4: "1881", card_brand: "master" });
    });

    it("AC4: un valor con forma inesperada no llega a la base", async () => {
      mp.createPayment.mockImplementation(
        async () => ({ ...withCard("12ab", "visa; drop table"), id: 1_000_001 }) as PaymentResponse
      );
      await create();
      expect(await historyRow()).toEqual({ payer_id: PAYER, card_last4: null, card_brand: null });
    });

    it("AC2: existen los índices de los listados por rol (emisor y transportista), más reciente primero", async () => {
      const rows = await app.db.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'payments' AND tablename = 'holds' AND indexname LIKE 'holds_%_created_at_idx'
          ORDER BY indexname`
      );
      expect(rows.map((r) => r.indexname)).toEqual([
        "holds_carrier_id_created_at_idx",
        "holds_payer_id_created_at_idx",
      ]);
      expect(rows[1].indexdef).toContain("(payer_id, created_at DESC, id DESC)");
    });
  });

  it("valida el body: uuid, monto positivo y email", async () => {
    const badId = await create({ shipmentId: "no-es-uuid" });
    expect(badId.statusCode).toBe(400);
    const badAmount = await create({ amountArs: 0 });
    expect(badAmount.statusCode).toBe(400);
    const badEmail = await create({ payerEmail: "inventado" });
    expect(badEmail.statusCode).toBe(400);
    // MOVO-282: `payerUserId` es obligatorio y `savedCardId`, si viene, un uuid.
    const noPayer = await app.inject({
      method: "POST",
      url: BASE,
      payload: { ...body(), payerUserId: undefined },
    });
    expect(noPayer.statusCode).toBe(400);
    const badCard = await create({ savedCardId: "no-es-uuid" });
    expect(badCard.statusCode).toBe(400);
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
