import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { MercadoPagoClient, PaymentResponse } from "../src/adapters/mercadopago-client";
import type { AlertNotifier } from "../src/adapters/alert-notifier";
import { createBalancePaymentAttemptRepository } from "../src/repositories/balance-payment-attempt-repository";
import { createBalanceCheckoutService } from "../src/modules/balance-checkout/balance-checkout.service";

// MOVO-312: integración contra Postgres/Redis reales (convención del repo). Se reemplazan solo los bordes
// externos: MP y el canal de alertas. El pago completado en el navegador contra el sandbox es la DoD manual.

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const SECRET = "test-webhook-secret";
const REDIRECT_URI = "https://api.movo.test/api/v1/payments/mp-connect/callback";
const BASE = "https://api.movo.test/api/v1";
const MP_PAYMENT = "777000111";
const WEBHOOK = "/payments/webhooks/mercadopago";

function signature(dataId: string, requestId: string, ts = "1700000000"): string {
  const v1 = createHmac("sha256", SECRET).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

describe("Pagar mi saldo con Checkout Pro (MOVO-312)", () => {
  let app: FastifyInstance;
  const mp = {
    createPayment: vi.fn(),
    getPayment: vi.fn(),
    capturePayment: vi.fn(),
    cancelPayment: vi.fn(),
    searchPaymentsByExternalReference: vi.fn(async () => [] as Array<Record<string, unknown>>),
    createPreference: vi.fn(),
  };
  const alerts = { send: vi.fn(async () => undefined) };
  const movoToken = { getToken: vi.fn(async () => "TEST-movo-token") };
  let preferenceSeq = 0;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_WEBHOOK_SECRET = SECRET;
    process.env.MP_REDIRECT_URI = REDIRECT_URI;
    process.env.MP_WEBHOOK_SWEEP_ENABLED = "false";
    app = buildApp({
      mercadoPagoClient: mp as unknown as MercadoPagoClient,
      alertNotifier: alerts as unknown as AlertNotifier,
      movoTokenProvider: movoToken,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.MP_WEBHOOK_SECRET;
    delete process.env.MP_REDIRECT_URI;
    delete process.env.MP_WEBHOOK_SWEEP_ENABLED;
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE payments.balance_payment_attempts, payments.user_ledger_entries, payments.mp_webhook_notifications, payments.holds CASCADE"
    );
    vi.clearAllMocks();
    preferenceSeq = 0;
    movoToken.getToken.mockImplementation(async () => "TEST-movo-token");
    mp.searchPaymentsByExternalReference.mockImplementation(async () => []);
    mp.createPreference.mockImplementation(async () => {
      preferenceSeq += 1;
      return { id: `pref-${preferenceSeq}`, init_point: `https://mp.test/checkout/pref-${preferenceSeq}`, sandbox_init_point: `https://sandbox.mp.test/checkout/pref-${preferenceSeq}` };
    });
  });

  async function owe(userId: string, amountArs: number) {
    await app.userLedger.createEntry(userId, {
      idempotencyKey: `penalty:${randomUUID()}`,
      type: "cancellation_penalty",
      amountArs,
    });
  }

  function checkout(amountArs: unknown, userId: string | null = USER) {
    return app.inject({
      method: "POST",
      url: "/payments/balance/checkout",
      headers: userId ? { "x-user-id": userId } : {},
      payload: { amountArs },
    });
  }

  const attempts = () => app.db.balancePaymentAttempt.findMany({ orderBy: { createdAt: "asc" } });
  const entries = (userId = USER) => app.db.userLedgerEntry.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

  /** El pago que MP devuelve al consultarlo con el token de Movo. */
  function mpPays(overrides: Partial<PaymentResponse> & Record<string, unknown>) {
    mp.getPayment.mockImplementation(async () => ({ id: Number(MP_PAYMENT), status: "approved", ...overrides }) as PaymentResponse);
  }

  async function notify(requestId = `req-${randomUUID()}`) {
    const res = await app.inject({
      method: "POST",
      url: `${WEBHOOK}?data.id=${MP_PAYMENT}&type=payment`,
      headers: { "x-request-id": requestId, "x-signature": signature(MP_PAYMENT, requestId) },
      payload: { id: randomUUID(), type: "payment", action: "payment.updated", live_mode: false, data: { id: MP_PAYMENT } },
    });
    await app.mpWebhooks.drain();
    return res;
  }

  describe("POST /payments/balance/checkout", () => {
    it("crea la preferencia con el token de Movo y devuelve el link; el intento queda pending", async () => {
      await owe(USER, 1000);

      const res = await checkout(600);

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.checkoutUrl).toBe("https://mp.test/checkout/pref-1");
      const [attempt] = await attempts();
      expect(attempt).toMatchObject({ id: body.attemptId, userId: USER, status: "pending", mpPreferenceId: "pref-1" });
      expect(attempt.amountArs.toFixed(2)).toBe("600.00");

      expect(mp.createPreference).toHaveBeenCalledTimes(1);
      const [token, preference, key] = mp.createPreference.mock.calls[0] as unknown as [string, Record<string, unknown>, string];
      expect(token).toBe("TEST-movo-token");
      expect(key).toBe(`movo-balance-checkout-${attempt.id}`);
      expect(preference).toMatchObject({
        external_reference: attempt.id,
        items: [{ quantity: 1, unit_price: 600, currency_id: "ARS" }],
        back_urls: {
          success: `${BASE}/payments/balance/checkout/return?result=success`,
          failure: `${BASE}/payments/balance/checkout/return?result=failure`,
          pending: `${BASE}/payments/balance/checkout/return?result=pending`,
        },
        notification_url: `${BASE}/payments/webhooks/mercadopago`,
        auto_return: "approved",
        expires: true,
      });
    });

    it("401 sin x-user-id", async () => {
      expect((await checkout(100, null)).statusCode).toBe(401);
    });

    it("400 con un monto inválido (cero, negativo, más de 2 decimales)", async () => {
      await owe(USER, 1000);
      for (const amount of [0, -5, 10.123]) {
        expect((await checkout(amount)).statusCode).toBe(400);
      }
      expect(mp.createPreference).not.toHaveBeenCalled();
    });

    it("422 si el monto supera la deuda", async () => {
      await owe(USER, 500);

      const res = await checkout(500.01);

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("BALANCE_AMOUNT_EXCEEDS_DEBT");
      expect(mp.createPreference).not.toHaveBeenCalled();
    });

    it("422 si no hay deuda o el saldo es a favor", async () => {
      expect((await checkout(100)).json().error.code).toBe("BALANCE_AMOUNT_EXCEEDS_DEBT");
      await app.userLedger.createEntry(USER, { idempotencyKey: "credit-1", type: "voluntary_payment", amountArs: -300, status: "settled" });
      expect((await checkout(100)).statusCode).toBe(422);
    });

    it("el saldo es del usuario autenticado: la deuda de otro no se puede pagar", async () => {
      await owe(OTHER_USER, 1000);
      expect((await checkout(100)).statusCode).toBe(422);
    });

    it("dos pedidos iguales en vuelo no crean dos preferencias", async () => {
      await owe(USER, 1000);
      // Retrasa la preferencia para que el segundo pedido llegue mientras el primero la está armando.
      mp.createPreference.mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { id: "pref-slow", init_point: "https://mp.test/checkout/pref-slow", sandbox_init_point: "https://sandbox.mp.test/x" };
      });

      const [a, b] = await Promise.all([checkout(400), checkout(400)]);

      // Uno arma el checkout; el otro recibe el mismo link o un 409 "estamos armando tu pago" (nunca una segunda preferencia).
      expect([a.statusCode, b.statusCode].filter((code) => code === 200).length).toBeGreaterThanOrEqual(1);
      for (const r of [a, b]) expect([200, 409]).toContain(r.statusCode);
      expect(mp.createPreference).toHaveBeenCalledTimes(1);
      expect(await attempts()).toHaveLength(1);
    });

    it("repetir el pedido con el checkout vigente devuelve el mismo link sin crear otra preferencia", async () => {
      await owe(USER, 1000);
      const first = (await checkout(400)).json();

      const second = (await checkout(400)).json();

      expect(second).toEqual(first);
      expect(mp.createPreference).toHaveBeenCalledTimes(1);
    });

    it("otro monto es otro checkout", async () => {
      await owe(USER, 1000);
      await checkout(400);

      const other = (await checkout(250)).json();

      expect(other.checkoutUrl).toBe("https://mp.test/checkout/pref-2");
      expect(await attempts()).toHaveLength(2);
    });

    it("si MP no crea la preferencia responde 502 y el intento queda cerrado: reintentar funciona", async () => {
      await owe(USER, 1000);
      mp.createPreference.mockRejectedValueOnce(new Error("MP caído"));

      const failed = await checkout(400);

      expect(failed.statusCode).toBe(502);
      expect((await attempts())[0].status).toBe("failed");
      const retry = await checkout(400);
      expect(retry.statusCode).toBe(200);
    });

    it("503 sin credenciales de Movo", async () => {
      await owe(USER, 1000);
      const { ApiError } = await import("@movo/shared");
      movoToken.getToken.mockRejectedValueOnce(new ApiError(503, "CARDS_NOT_CONFIGURED", "sin configurar"));

      const res = await checkout(400);

      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("BALANCE_CHECKOUT_NOT_CONFIGURED");
    });
  });

  describe("GET /payments/balance/checkout/return", () => {
    it("responde un 302 al deep link de la app, sin JWT", async () => {
      const res = await app.inject({ method: "GET", url: "/payments/balance/checkout/return?result=success&payment_id=1&status=approved" });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("movo://balance?result=success");
    });

    it("un resultado desconocido se toma como failure (el query no es de confianza)", async () => {
      const res = await app.inject({ method: "GET", url: "/payments/balance/checkout/return?result=//evil.example" });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("movo://balance?result=failure");
    });
  });

  describe("webhook de MP", () => {
    async function pendingAttempt(amountArs = 600) {
      await owe(USER, 1000);
      return (await checkout(amountArs)).json() as { attemptId: string };
    }

    it("pago aprobado: asienta UN voluntary_payment settled y baja el saldo", async () => {
      const { attemptId } = await pendingAttempt(600);
      mpPays({ status: "approved", external_reference: attemptId, transaction_amount: 600 });

      const res = await notify();

      expect(res.statusCode).toBe(200);
      const list = await entries();
      const payment = list.find((e) => e.type === "voluntary_payment");
      expect(payment).toMatchObject({ status: "settled", paymentId: MP_PAYMENT, idempotencyKey: `balance-payment:${attemptId}` });
      expect(payment!.amountArs.toFixed(2)).toBe("-600.00");
      expect((await app.userLedger.balance(USER)).balanceArs).toBe(400);
      expect((await attempts())[0]).toMatchObject({ status: "approved", mpPaymentId: MP_PAYMENT });
      // Se consultó con el token de MOVO, no el de un transportista.
      expect(mp.getPayment).toHaveBeenCalledWith("TEST-movo-token", MP_PAYMENT);
    });

    it("la misma notificación reenviada, o dos en paralelo, no acreditan dos veces", async () => {
      const { attemptId } = await pendingAttempt(600);
      mpPays({ status: "approved", external_reference: attemptId, transaction_amount: 600 });

      await Promise.all([notify("req-a"), notify("req-b"), notify("req-c")]);
      await notify("req-d");

      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(1);
      expect((await app.userLedger.balance(USER)).balanceArs).toBe(400);
    });

    it("rechazado o cancelado: sin movimiento y el intento queda rejected", async () => {
      const { attemptId } = await pendingAttempt(600);
      mpPays({ status: "rejected", external_reference: attemptId, transaction_amount: 600 });

      await notify();

      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(0);
      expect((await attempts())[0].status).toBe("rejected");
    });

    it("pendiente o en proceso: no hay resultado todavía", async () => {
      const { attemptId } = await pendingAttempt(600);
      mpPays({ status: "in_process", external_reference: attemptId, transaction_amount: 600 });

      await notify();

      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(0);
      expect((await attempts())[0].status).toBe("pending");
    });

    it("un monto distinto del intento no se acredita y avisa al equipo", async () => {
      const { attemptId } = await pendingAttempt(600);
      mpPays({ status: "approved", external_reference: attemptId, transaction_amount: 60 });

      await notify();

      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(0);
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "mp_balance_payment_amount_mismatch" }));
    });

    it("un pago aprobado tardío sobre un intento ya rechazado igual se acredita (es plata recibida)", async () => {
      const { attemptId } = await pendingAttempt(600);
      mpPays({ status: "rejected", external_reference: attemptId, transaction_amount: 600 });
      await notify("req-1");
      mpPays({ status: "approved", external_reference: attemptId, transaction_amount: 600 });

      await notify("req-2");

      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(1);
      expect((await attempts())[0].status).toBe("approved");
    });

    it("contracargo o reembolso de un pago de saldo: no toca el ledger y avisa al equipo", async () => {
      const { attemptId } = await pendingAttempt(600);
      mpPays({ status: "charged_back", external_reference: attemptId, transaction_amount: 600 });

      await notify();

      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(0);
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "mp_balance_payment_charged_back" }));
    });

    it("un pago que no es de ningún intento sigue el camino de siempre (ignorado)", async () => {
      mpPays({ status: "approved", external_reference: randomUUID(), transaction_amount: 600 });

      const res = await notify();

      expect(res.statusCode).toBe(200);
      const [row] = await app.db.mpWebhookNotification.findMany();
      expect(row.status).toBe("ignored");
      expect(row.outcome).toBe("unknown_payment");
    });

    it("un pago ajeno a Movo (MP responde 404) también se ignora, sin reintentar", async () => {
      mp.getPayment.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));

      await notify();

      const [row] = await app.db.mpWebhookNotification.findMany();
      expect(row.status).toBe("ignored");
    });
  });

  describe("conciliación con MP (webhook perdido o intento abandonado)", () => {
    function service(now: Date, testMode = false) {
      return createBalanceCheckoutService({
        attempts: createBalancePaymentAttemptRepository(app.db),
        ledger: app.userLedger,
        mercadoPago: mp as unknown as MercadoPagoClient,
        movoToken,
        alerts: alerts as unknown as AlertNotifier,
        log: app.log,
        redirectUri: REDIRECT_URI,
        testMode,
        now: () => now,
      });
    }

    it("un pago aprobado cuyo webhook no llegó se acredita al pedir un nuevo checkout", async () => {
      await owe(USER, 1000);
      const { attemptId } = (await checkout(600)).json();
      mp.searchPaymentsByExternalReference.mockImplementation(async () => [
        { id: Number(MP_PAYMENT), status: "approved", transaction_amount: 600 },
      ]);

      // Con 600 ya pagados el saldo es 400: un pedido de 500 supera la deuda real.
      const res = await checkout(500);

      expect(res.statusCode).toBe(422);
      expect((await entries()).filter((e) => e.type === "voluntary_payment")).toHaveLength(1);
      expect((await attempts()).find((a) => a.id === attemptId)?.status).toBe("approved");
    });

    it("un intento vencido sin pago se abandona y el pedido crea un checkout nuevo", async () => {
      await owe(USER, 1000);
      const first = (await checkout(400)).json();
      const future = new Date(Date.now() + 25 * 60 * 60 * 1000);

      const second = await service(future).createCheckout(USER, 400);

      expect(second.checkoutUrl).not.toBe(first.checkoutUrl);
      const rows = await attempts();
      expect(rows.find((a) => a.id === first.attemptId)?.status).toBe("abandoned");
    });

    it("en modo test el navegador abre el sandbox_init_point", async () => {
      await owe(USER, 1000);

      const res = await service(new Date(), true).createCheckout(USER, 100);

      expect(res.checkoutUrl).toBe("https://sandbox.mp.test/checkout/pref-1");
    });

    it("sin `MP_REDIRECT_URI` no hay checkout (503)", async () => {
      await owe(USER, 1000);
      const noRedirect = createBalanceCheckoutService({
        attempts: createBalancePaymentAttemptRepository(app.db),
        ledger: app.userLedger,
        mercadoPago: mp as unknown as MercadoPagoClient,
        movoToken,
        alerts: alerts as unknown as AlertNotifier,
        log: app.log,
        redirectUri: undefined,
        testMode: false,
      });

      await expect(noRedirect.createCheckout(USER, 100)).rejects.toMatchObject({ code: "BALANCE_CHECKOUT_NOT_CONFIGURED" });
    });
  });
});
