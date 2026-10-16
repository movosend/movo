import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { MercadoPagoClient } from "../src/adapters/mercadopago-client";
import type { AlertNotifier } from "../src/adapters/alert-notifier";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../src/utils/token-cipher";

// MOVO-312: integración contra Postgres/Redis reales (convención del repo). Se reemplazan solo los bordes externos:
// MP y el canal de alertas. El pago real contra el sandbox es la DoD manual.

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const COLLECTOR = "99999999-9999-4999-8999-999999999999";
const COLLECTOR_MP_USER = "3609549431";
const SECRET = "test-webhook-secret";
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
const MP_PAYMENT = "777000111";
const WEBHOOK = "/payments/webhooks/mercadopago";

function signature(dataId: string, requestId: string, ts = "1700000000"): string {
  const v1 = createHmac("sha256", SECRET).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

describe("Pagar mi saldo con Checkout API (MOVO-312)", () => {
  let app: FastifyInstance;
  const mp = {
    createPayment: vi.fn(),
    getPayment: vi.fn(),
    capturePayment: vi.fn(),
    cancelPayment: vi.fn(),
    searchPaymentsByExternalReference: vi.fn(async () => [] as Array<Record<string, unknown>>),
  };
  const alerts = { send: vi.fn(async () => undefined) };
  let cardId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_WEBHOOK_SECRET = SECRET;
    process.env.MP_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    process.env.MOVO_COLLECTOR_USER_ID = COLLECTOR;
    process.env.MP_WEBHOOK_SWEEP_ENABLED = "false";
    app = buildApp({
      mercadoPagoClient: mp as unknown as MercadoPagoClient,
      alertNotifier: alerts as unknown as AlertNotifier,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    for (const name of ["MP_WEBHOOK_SECRET", "MP_TOKEN_ENCRYPTION_KEY", "MOVO_COLLECTOR_USER_ID", "MP_WEBHOOK_SWEEP_ENABLED"]) {
      delete process.env[name];
    }
  });

  /** Vincula (o re-vincula) la cuenta cobradora de Movo con el vencimiento pedido. */
  async function linkCollector(tokenExpiresAt = new Date(Date.now() + 86_400_000)) {
    await createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).upsertLinked(
      COLLECTOR,
      {
        mpUserId: COLLECTOR_MP_USER,
        email: "movo@example.com",
        nickname: "MOVO",
        accessToken: "TEST-collector-access",
        refreshToken: "TG-collector-refresh",
        publicKey: "TEST-collector-public-key",
        scope: "offline_access",
        tokenExpiresAt,
      },
      new Date()
    );
  }

  /** Una tarjeta viva del usuario en su customer de la cuenta de Movo S.A. */
  async function seedCard(userId = USER, overrides: { deletedAt?: Date } = {}) {
    await app.db.payerCustomer.upsert({
      where: { userId },
      create: { userId, mpCustomerId: `mp-customer-${userId.slice(0, 4)}` },
      update: {},
    });
    const card = await app.db.savedCard.create({
      data: { userId, mpCardId: "mp-card-secret", brand: "visa", last4: "3704", expMonth: 11, expYear: 2030, ...overrides },
    });
    return card.id;
  }

  beforeEach(async () => {
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE payments.balance_payment_attempts, payments.user_ledger_entries, payments.mp_webhook_notifications, payments.holds, payments.carrier_mp_accounts, payments.saved_cards, payments.payer_customers CASCADE"
    );
    vi.clearAllMocks();
    mp.searchPaymentsByExternalReference.mockImplementation(async () => []);
    mp.createPayment.mockImplementation(async (_token: string, body: { transaction_amount: number; external_reference: string }) => ({
      id: Number(MP_PAYMENT),
      status: "approved",
      status_detail: "accredited",
      transaction_amount: body.transaction_amount,
      external_reference: body.external_reference,
    }));
    await linkCollector();
    cardId = await seedCard();
  });

  async function owe(userId: string, amountArs: number) {
    await app.userLedger.createEntry(userId, {
      idempotencyKey: `penalty:${randomUUID()}`,
      type: "cancellation_penalty",
      amountArs,
    });
  }

  function pay(overrides: Record<string, unknown> = {}, userId: string | null = USER) {
    return app.inject({
      method: "POST",
      url: "/payments/balance/pay",
      headers: userId ? { "x-user-id": userId } : {},
      payload: { amountArs: 600, cardToken: "card-token-1", savedCardId: cardId, paymentMethodId: "visa", ...overrides },
    });
  }

  const attempts = () => app.db.balancePaymentAttempt.findMany({ orderBy: { createdAt: "asc" } });
  const entries = (userId = USER) => app.db.userLedgerEntry.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

  /** Lo que MP devuelve al crear el pago. */
  function mpCreates(overrides: Record<string, unknown>) {
    mp.createPayment.mockImplementation(async (_token: string, body: { transaction_amount: number; external_reference: string }) => ({
      id: Number(MP_PAYMENT),
      status: "approved",
      transaction_amount: body.transaction_amount,
      external_reference: body.external_reference,
      ...overrides,
    }));
  }

  describe("GET /payments/balance/pay-data", () => {
    it("devuelve la public_key de la cuenta cobradora y el saldo deudor", async () => {
      await owe(USER, 1000);

      const res = await app.inject({ method: "GET", url: "/payments/balance/pay-data", headers: { "x-user-id": USER } });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ publicKey: "TEST-collector-public-key", balanceArs: 1000 });
    });

    it("422 si no hay deuda", async () => {
      const res = await app.inject({ method: "GET", url: "/payments/balance/pay-data", headers: { "x-user-id": USER } });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("BALANCE_AMOUNT_EXCEEDS_DEBT");
    });

    it("503 si la cuenta cobradora no está vinculada, o su token venció", async () => {
      await owe(USER, 1000);
      await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.carrier_mp_accounts CASCADE");
      const unlinked = await app.inject({ method: "GET", url: "/payments/balance/pay-data", headers: { "x-user-id": USER } });
      expect(unlinked.statusCode).toBe(503);
      expect(unlinked.json().error.code).toBe("BALANCE_COLLECTOR_NOT_CONFIGURED");

      await linkCollector(new Date(Date.now() - 1000));
      const expired = await app.inject({ method: "GET", url: "/payments/balance/pay-data", headers: { "x-user-id": USER } });
      expect(expired.statusCode).toBe(503);
    });
  });

  describe("POST /payments/balance/pay", () => {
    it("401 sin x-user-id", async () => {
      expect((await pay({}, null)).statusCode).toBe(401);
    });

    it("400 con un monto inválido (cero, negativo, más de 2 decimales) o sin tarjeta", async () => {
      await owe(USER, 1000);
      for (const amountArs of [0, -5, 10.123]) {
        expect((await pay({ amountArs })).statusCode).toBe(400);
      }
      expect((await pay({ savedCardId: undefined })).statusCode).toBe(400);
      expect(mp.createPayment).not.toHaveBeenCalled();
    });

    it("pago aprobado: cobra a la tarjeta guardada con el token de la cobradora y asienta UN voluntary_payment", async () => {
      await owe(USER, 1000);

      const res = await pay({ amountArs: 600 });

      expect(res.statusCode).toBe(200);
      const [attempt] = await attempts();
      expect(res.json()).toEqual({ attemptId: attempt.id, status: "approved", failureReason: null, balanceArs: 400 });
      expect(attempt).toMatchObject({ userId: USER, status: "approved", mpPaymentId: MP_PAYMENT, savedCardId: cardId });

      expect(mp.createPayment).toHaveBeenCalledTimes(1);
      const [token, body, key] = mp.createPayment.mock.calls[0] as unknown as [string, Record<string, unknown>, string];
      expect(token).toBe("TEST-collector-access");
      expect(key).toBe(`movo-balance-${attempt.id}`);
      expect(body).toMatchObject({
        transaction_amount: 600,
        installments: 1,
        token: "card-token-1",
        payment_method_id: "visa",
        external_reference: attempt.id,
        payer: { type: "customer", id: `mp-customer-${USER.slice(0, 4)}` },
      });
      // Pago directo a Movo: sin hold ni comisión de marketplace.
      expect(body).not.toHaveProperty("capture");
      expect(body).not.toHaveProperty("application_fee");

      const rows = await entries();
      const payments = rows.filter((e) => e.type === "voluntary_payment");
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({ status: "settled", idempotencyKey: `balance-payment:${attempt.id}` });
      expect(payments[0].amountArs.toNumber()).toBe(-600);
    });

    it("la respuesta y los logs no exponen el customer ni la tarjeta de MP", async () => {
      await owe(USER, 1000);
      const res = await pay();
      expect(JSON.stringify(res.json())).not.toMatch(/mp-customer|mp-card-secret|card-token-1/);
    });

    it("422 si el monto supera la deuda, o no hay deuda, y no llama a MP", async () => {
      await owe(USER, 500);
      const over = await pay({ amountArs: 600 });
      expect(over.statusCode).toBe(422);
      expect(over.json().error.code).toBe("BALANCE_AMOUNT_EXCEEDS_DEBT");

      const noDebt = await pay({}, OTHER_USER);
      expect(noDebt.statusCode).toBe(422);
      expect(mp.createPayment).not.toHaveBeenCalled();
    });

    it("404 si la tarjeta no es del usuario o está dada de baja, sin abrir un intento", async () => {
      await owe(USER, 1000);
      const otherCard = await seedCard(OTHER_USER);
      const stranger = await pay({ savedCardId: otherCard });
      expect(stranger.statusCode).toBe(404);
      expect(stranger.json().error.code).toBe("SAVED_CARD_NOT_FOUND");

      await app.db.savedCard.update({ where: { id: cardId }, data: { deletedAt: new Date() } });
      expect((await pay()).statusCode).toBe(404);
      expect(await attempts()).toHaveLength(0);
      expect(mp.createPayment).not.toHaveBeenCalled();
    });

    it("un rechazo de la tarjeta es un 200 con el motivo y no toca el saldo", async () => {
      await owe(USER, 1000);
      mpCreates({ status: "rejected", status_detail: "cc_rejected_insufficient_amount" });

      const res = await pay();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "rejected", failureReason: "insufficient_funds", balanceArs: 1000 });
      expect((await attempts())[0].status).toBe("rejected");
      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(0);
    });

    it("tras un rechazo se puede reintentar el mismo monto con otra tarjeta", async () => {
      await owe(USER, 1000);
      mpCreates({ id: 555000222, status: "rejected", status_detail: "cc_rejected_other_reason" });
      expect((await pay()).json().status).toBe("rejected");

      // Cada intento de MP tiene su propio id de pago.
      mpCreates({ status: "approved" });
      const retry = await pay();

      expect(retry.json().status).toBe("approved");
      expect(await attempts()).toHaveLength(2);
    });

    it("un token inválido o vencido (3031) cierra el intento como invalid_data", async () => {
      await owe(USER, 1000);
      mp.createPayment.mockRejectedValueOnce({ status: 400, message: "security_code_id can't be null", causes: [{ code: 3031 }] });

      const res = await pay();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "rejected", failureReason: "invalid_data" });
    });

    it("in_process: el intento queda pending, el saldo no cambia y el webhook lo resuelve", async () => {
      await owe(USER, 1000);
      mpCreates({ status: "in_process", status_detail: "pending_contingency" });

      const res = await pay();

      expect(res.json()).toMatchObject({ status: "pending", failureReason: null, balanceArs: 1000 });
      expect((await attempts())[0]).toMatchObject({ status: "pending", mpPaymentId: MP_PAYMENT });
      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(0);
    });

    it("dos pedidos iguales en vuelo no crean dos pagos", async () => {
      await owe(USER, 1000);
      mpCreates({ status: "in_process" });

      const [a, b] = await Promise.all([pay(), pay()]);

      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 200].sort());
      expect(await attempts()).toHaveLength(1);
      expect(mp.createPayment.mock.calls.length).toBeLessThanOrEqual(2);
      // Aunque los dos llegaran a MP, comparten la idempotency key del intento: MP devuelve el mismo pago.
      const keys = new Set(mp.createPayment.mock.calls.map((c) => (c as unknown as [string, unknown, string])[2]));
      expect(keys.size).toBe(1);
    });

    it("un pedido distinto (otro token) con un pago igual en curso responde 409", async () => {
      await owe(USER, 1000);
      mpCreates({ status: "in_process" });
      expect((await pay()).statusCode).toBe(200);

      // El primero quedó `pending`: un segundo pedido igual devuelve su resultado, sin crear otro pago.
      const again = await pay({ cardToken: "card-token-2" });
      expect(again.statusCode).toBe(200);
      expect(again.json().status).toBe("pending");
      expect(mp.createPayment).toHaveBeenCalledTimes(1);
    });

    it("sin respuesta de MP (502) el intento queda creating y el reintento reusa la misma idempotency key", async () => {
      await owe(USER, 1000);
      mp.createPayment.mockRejectedValueOnce(new Error("timeout"));

      const first = await pay();
      expect(first.statusCode).toBe(502);
      expect((await attempts())[0].status).toBe("creating");

      const retry = await pay();
      expect(retry.statusCode).toBe(200);
      expect(retry.json().status).toBe("approved");
      const keys = mp.createPayment.mock.calls.map((c) => (c as unknown as [string, unknown, string])[2]);
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe(keys[1]);
      expect(await attempts()).toHaveLength(1);
    });

    it("sin respuesta de MP y con otro token, el reintento espera (409) en vez de duplicar el cobro", async () => {
      await owe(USER, 1000);
      mp.createPayment.mockRejectedValueOnce(new Error("timeout"));
      expect((await pay()).statusCode).toBe(502);

      const other = await pay({ cardToken: "card-token-2" });

      expect(other.statusCode).toBe(409);
      expect(other.json().error.code).toBe("BALANCE_PAYMENT_IN_PROGRESS");
    });

    it("si MP rechaza el token de la cuenta cobradora responde 503, avisa al equipo y cierra el intento", async () => {
      await owe(USER, 1000);
      mp.createPayment.mockRejectedValueOnce({ status: 401, message: "invalid access token" });

      const res = await pay();

      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("BALANCE_COLLECTOR_NOT_CONFIGURED");
      expect((await attempts())[0].status).toBe("failed");
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "mp_balance_collector_auth" }));
    });

    it("el saldo es del usuario autenticado: la deuda de otro no se puede pagar", async () => {
      await owe(OTHER_USER, 1000);
      const res = await pay({}, USER);
      expect(res.statusCode).toBe(422);
    });
  });

  describe("webhook de MP", () => {
    async function notify(mpUserId: string | null = COLLECTOR_MP_USER, requestId = `req-${randomUUID()}`) {
      const res = await app.inject({
        method: "POST",
        url: `${WEBHOOK}?data.id=${MP_PAYMENT}&type=payment`,
        headers: { "x-request-id": requestId, "x-signature": signature(MP_PAYMENT, requestId) },
        payload: {
          id: randomUUID(),
          type: "payment",
          action: "payment.updated",
          live_mode: false,
          ...(mpUserId ? { user_id: mpUserId } : {}),
          data: { id: MP_PAYMENT },
        },
      });
      await app.mpWebhooks.drain();
      return res;
    }

    /** Un intento pendiente con el pago en proceso. */
    async function pendingAttempt(amountArs = 600) {
      await owe(USER, 1000);
      mpCreates({ status: "in_process" });
      await pay({ amountArs });
      const [attempt] = await attempts();
      return attempt;
    }

    function mpPays(attemptId: string, overrides: Record<string, unknown>) {
      mp.getPayment.mockImplementation(async () => ({
        id: Number(MP_PAYMENT),
        status: "approved",
        transaction_amount: 600,
        external_reference: attemptId,
        ...overrides,
      }));
    }

    it("el pago pendiente que se aprueba asienta UN voluntary_payment y baja el saldo", async () => {
      const attempt = await pendingAttempt();
      mpPays(attempt.id, { status: "approved" });

      await notify();

      expect(mp.getPayment).toHaveBeenCalledWith("TEST-collector-access", MP_PAYMENT);
      expect((await attempts())[0].status).toBe("approved");
      const payments = (await entries()).filter((e) => e.type === "voluntary_payment");
      expect(payments).toHaveLength(1);
      expect((await app.userLedger.balance(USER)).balanceArs).toBe(400);
    });

    it("la misma notificación reenviada, o dos en paralelo, no acreditan dos veces", async () => {
      const attempt = await pendingAttempt();
      mpPays(attempt.id, { status: "approved" });

      await Promise.all([notify(COLLECTOR_MP_USER, "req-a"), notify(COLLECTOR_MP_USER, "req-b")]);
      await notify(COLLECTOR_MP_USER, "req-c");

      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(1);
    });

    it("rechazado o cancelado: sin movimiento y el intento queda rejected", async () => {
      const attempt = await pendingAttempt();
      mpPays(attempt.id, { status: "rejected", status_detail: "cc_rejected_other_reason" });

      await notify();

      expect((await attempts())[0]).toMatchObject({ status: "rejected", failureReason: "card_rejected" });
      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(0);
    });

    it("un monto distinto del intento no se acredita y avisa al equipo", async () => {
      const attempt = await pendingAttempt();
      mpPays(attempt.id, { status: "approved", transaction_amount: 1 });

      await notify();

      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(0);
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "mp_balance_payment_amount_mismatch" }));
    });

    it("un aprobado tardío sobre un intento ya rechazado igual se acredita (es plata recibida)", async () => {
      const attempt = await pendingAttempt();
      await app.db.balancePaymentAttempt.update({ where: { id: attempt.id }, data: { status: "rejected" } });
      mpPays(attempt.id, { status: "approved" });

      await notify();

      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(1);
      expect((await attempts())[0].status).toBe("approved");
    });

    it("contracargo o reembolso de un pago de saldo: no toca el ledger y avisa al equipo", async () => {
      const attempt = await pendingAttempt();
      mpPays(attempt.id, { status: "charged_back" });

      await notify();

      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(0);
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "mp_balance_payment_charged_back" }));
    });

    it("un pago que no es de ningún intento sigue el camino de siempre (ignorado)", async () => {
      await owe(USER, 1000);
      mpPays(randomUUID(), { status: "approved" });

      const res = await notify();

      expect(res.statusCode).toBe(200);
      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(0);
    });

    it("una notificación de otra cuenta (un transportista) no se mira como pago de saldo", async () => {
      await pendingAttempt();

      await notify("1000000001");

      expect(mp.getPayment).not.toHaveBeenCalledWith("TEST-collector-access", MP_PAYMENT);
    });
  });

  describe("conciliación con MP (webhook perdido o intento sin resolver)", () => {
    it("un pago aprobado cuyo webhook no llegó se acredita al volver a pedir pay-data", async () => {
      await owe(USER, 1000);
      mpCreates({ status: "in_process" });
      await pay({ amountArs: 600 });
      const [attempt] = await attempts();
      mp.searchPaymentsByExternalReference.mockImplementation(async () => [
        { id: Number(MP_PAYMENT), status: "approved", transaction_amount: 600, external_reference: attempt.id },
      ]);

      const res = await app.inject({ method: "GET", url: "/payments/balance/pay-data", headers: { "x-user-id": USER } });

      expect(res.statusCode).toBe(200);
      expect(res.json().balanceArs).toBe(400);
      expect((await attempts())[0].status).toBe("approved");
    });

    it("un intento creating viejo sin pago en MP se descarta y se puede volver a pagar", async () => {
      await owe(USER, 1000);
      mp.createPayment.mockRejectedValueOnce(new Error("timeout"));
      expect((await pay({}, USER)).statusCode).toBe(502);
      await app.db.$executeRawUnsafe(
        "UPDATE payments.balance_payment_attempts SET created_at = now() - interval '1 hour'"
      );

      const res = await pay({ cardToken: "card-token-2" });

      expect(res.statusCode).toBe(200);
      const rows = await attempts();
      expect(rows.map((r) => r.status)).toEqual(["failed", "approved"]);
    });
  });
});
