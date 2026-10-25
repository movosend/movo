import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { MercadoPagoClient, PaymentResponse } from "../src/adapters/mercadopago-client";
import type { ShipmentsClient } from "../src/adapters/shipments-client";
import { ShipmentsUnavailableError } from "../src/adapters/shipments-client";
import type { AlertNotifier } from "../src/adapters/alert-notifier";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../src/utils/token-cipher";

// MOVO-268: integración contra Postgres real (convención del repo). Se reemplazan solo los
// bordes externos: MP, svc-shipments y el canal de alertas. La notificación real del
// sandbox recibida por un túnel es la DoD manual (ver CLAUDE.md del servicio).

const SECRET = "test-webhook-secret";
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MP_USER = "1000000001";
const PAYMENT_ID = "555000111";
const URL = "/payments/webhooks/mercadopago";

function payment(overrides: Partial<PaymentResponse> = {}): PaymentResponse {
  return {
    id: Number(PAYMENT_ID),
    status: "authorized",
    status_detail: "pending_capture",
    external_reference: SHIPMENT,
    ...overrides,
  } as PaymentResponse;
}

function signature(dataId: string, requestId: string, ts = "1700000000"): string {
  const v1 = createHmac("sha256", SECRET).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

describe("POST /payments/webhooks/mercadopago (MOVO-268)", () => {
  let app: FastifyInstance;
  const mp = {
    createPayment: vi.fn(),
    getPayment: vi.fn(async () => payment()),
    capturePayment: vi.fn(),
    cancelPayment: vi.fn(),
    searchPaymentsByExternalReference: vi.fn(async () => [] as Array<{ id: number; status: string }>),
  };
  const shipments = { notifyHoldEvent: vi.fn(async () => ({ handled: true, outcome: "awaiting_payment" })) };
  const alerts = { send: vi.fn(async () => undefined) };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    process.env.MP_WEBHOOK_SECRET = SECRET;
    process.env.MP_WEBHOOK_SWEEP_ENABLED = "false";
    app = buildApp({
      mercadoPagoClient: mp as unknown as MercadoPagoClient,
      shipmentsClient: shipments as unknown as ShipmentsClient,
      alertNotifier: alerts as unknown as AlertNotifier,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.MP_TOKEN_ENCRYPTION_KEY;
    delete process.env.MP_WEBHOOK_SECRET;
    delete process.env.MP_WEBHOOK_SWEEP_ENABLED;
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE payments.mp_webhook_notifications, payments.payment_provider_events, payments.settlements, payments.holds, payments.carrier_mp_accounts CASCADE"
    );
    vi.clearAllMocks();
    mp.getPayment.mockImplementation(async () => payment());
    mp.searchPaymentsByExternalReference.mockImplementation(async () => []);
    shipments.notifyHoldEvent.mockImplementation(async () => ({ handled: true, outcome: "awaiting_payment" }));
    await linkCarrier();
  });

  async function linkCarrier() {
    await createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).upsertLinked(
      CARRIER,
      {
        mpUserId: MP_USER,
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
  }

  async function seedHold(overrides: Record<string, unknown> = {}) {
    return app.db.hold.create({
      data: {
        shipmentId: SHIPMENT,
        attempt: 1,
        carrierId: CARRIER,
        collectorId: MP_USER,
        mpPaymentId: PAYMENT_ID,
        amountArs: 1150,
        applicationFeeArs: 150,
        baseAmountArs: 1150,
        commissionArs: 150,
        status: "authorized",
        statusDetail: "pending_capture",
        expiresAt: new Date(Date.now() + 5 * 86_400_000),
        ...overrides,
      },
    });
  }

  async function notify(opts: { notificationId?: string | number; requestId?: string; dataId?: string; type?: string } = {}) {
    const dataId = opts.dataId ?? PAYMENT_ID;
    const requestId = opts.requestId ?? `req-${opts.notificationId ?? 1}`;
    const res = await app.inject({
      method: "POST",
      url: `${URL}?data.id=${dataId}&type=${opts.type ?? "payment"}`,
      headers: { "x-request-id": requestId, "x-signature": signature(dataId, requestId) },
      payload: {
        id: opts.notificationId ?? 1,
        type: opts.type ?? "payment",
        action: "payment.updated",
        user_id: Number(MP_USER),
        live_mode: false,
        data: { id: dataId },
      },
    });
    await app.mpWebhooks.drain();
    return res;
  }

  /** Reenvía una notificación ya firmada (mismos headers) cambiando campos del body que la firma NO cubre. */
  async function replay(bodyOverrides: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: `${URL}?data.id=${PAYMENT_ID}&type=payment`,
      headers: { "x-request-id": "req-replay", "x-signature": signature(PAYMENT_ID, "req-replay") },
      payload: {
        id: 1,
        type: "payment",
        action: "payment.updated",
        user_id: Number(MP_USER),
        live_mode: false,
        data: { id: PAYMENT_ID },
        ...bodyOverrides,
      },
    });
    await app.mpWebhooks.drain();
    return res;
  }

  const notifications = () => app.db.mpWebhookNotification.findMany({ orderBy: { receivedAt: "asc" } });
  const hold = async () => (await app.db.hold.findFirst({ where: { shipmentId: SHIPMENT } }))!;

  describe("firma (AC2)", () => {
    it("una firma inválida responde 401 y no toca nada", async () => {
      await seedHold();
      const res = await app.inject({
        method: "POST",
        url: `${URL}?data.id=${PAYMENT_ID}&type=payment`,
        headers: { "x-request-id": "req-1", "x-signature": signature("999", "req-1") },
        payload: { id: 1, type: "payment", data: { id: PAYMENT_ID } },
      });
      await app.mpWebhooks.drain();

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("PAYMENT_WEBHOOK_INVALID_SIGNATURE");
      expect(await notifications()).toHaveLength(0);
      expect(mp.getPayment).not.toHaveBeenCalled();
      expect((await hold()).status).toBe("authorized");
    });

    it("sin x-signature responde 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: `${URL}?data.id=${PAYMENT_ID}&type=payment`,
        headers: { "x-request-id": "req-1" },
        payload: { id: 1, type: "payment", data: { id: PAYMENT_ID } },
      });
      expect(res.statusCode).toBe(401);
      expect(await notifications()).toHaveLength(0);
    });

    it("sin MP_WEBHOOK_SECRET configurada rechaza todo con 503", async () => {
      const original = app.config.MP_WEBHOOK_SECRET;
      app.config.MP_WEBHOOK_SECRET = "";
      try {
        const res = await notify();
        expect(res.statusCode).toBe(503);
        expect(res.json().error.code).toBe("PAYMENT_WEBHOOK_NOT_CONFIGURED");
        expect(await notifications()).toHaveLength(0);
      } finally {
        app.config.MP_WEBHOOK_SECRET = original;
      }
    });

    it("un tópico que no es payment responde 200 y no se guarda", async () => {
      const res = await notify({ type: "merchant_order" });
      expect(res.statusCode).toBe(200);
      expect(await notifications()).toHaveLength(0);
    });
  });

  describe("hold cancelado o vencido por MP (AC3/AC4)", () => {
    it("vencido: marca el hold y avisa a svc-shipments con event expired", async () => {
      const seeded = await seedHold();
      mp.getPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "expired" }));

      const res = await notify();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });
      // AC3: se consulta con el token del transportista, no se usa el body.
      expect(mp.getPayment).toHaveBeenCalledWith("TEST-access-secret", PAYMENT_ID);
      const updated = await hold();
      expect(updated.status).toBe("cancelled");
      expect(updated.statusDetail).toBe("expired");
      expect(updated.expiresAt).toBeNull();
      expect(shipments.notifyHoldEvent).toHaveBeenCalledTimes(1);
      expect(shipments.notifyHoldEvent).toHaveBeenCalledWith(SHIPMENT, {
        holdId: seeded.id,
        event: "expired",
        statusDetail: "expired",
      });
      const [row] = await notifications();
      expect(row).toMatchObject({ status: "processed", holdId: seeded.id, pendingHoldEvent: null, attempts: 1 });
    });

    it("cancelado por MP (no vencido): event cancelled", async () => {
      await seedHold();
      mp.getPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "by_admin" }));
      await notify();
      expect(shipments.notifyHoldEvent).toHaveBeenCalledWith(SHIPMENT, expect.objectContaining({ event: "cancelled" }));
    });

    it("un in_process que MP rechaza: event rejected", async () => {
      await seedHold({ status: "in_process", statusDetail: "pending_contingency" });
      mp.getPayment.mockImplementation(async () =>
        payment({ status: "rejected", status_detail: "cc_rejected_high_risk" })
      );
      await notify();
      expect((await hold()).status).toBe("rejected");
      expect((await hold()).failureReason).toBe("card_rejected");
      expect(shipments.notifyHoldEvent).toHaveBeenCalledWith(SHIPMENT, expect.objectContaining({ event: "rejected" }));
    });

    it("un in_process que MP autoriza: actualiza la fila sin avisar (lo levanta el barrido de shipments)", async () => {
      await seedHold({ status: "in_process", statusDetail: "pending_contingency" });
      await notify();
      expect((await hold()).status).toBe("authorized");
      expect(shipments.notifyHoldEvent).not.toHaveBeenCalled();
      expect((await notifications())[0].outcome).toBe("hold_authorized");
    });

    it("la liberación hecha por Movo que vuelve como webhook no avisa a nadie", async () => {
      await seedHold({ status: "cancelled", statusDetail: "by_collector", expiresAt: null });
      mp.getPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "by_collector" }));
      await notify();
      expect(shipments.notifyHoldEvent).not.toHaveBeenCalled();
      expect((await notifications())[0].outcome).toBe("hold_already_cancelled");
    });

    it("hold perdido con el paquete en camino: alerta al equipo", async () => {
      await seedHold();
      mp.getPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "expired" }));
      shipments.notifyHoldEvent.mockImplementation(async () => ({ handled: false, outcome: "hold_lost_after_pickup" }));
      await notify();
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "mp_hold_lost_after_pickup" }));
    });

    it("approved no toca el hold: la captura es de MOVO-212", async () => {
      await seedHold();
      mp.getPayment.mockImplementation(async () => payment({ status: "approved", status_detail: "accredited" }));
      await notify();
      expect((await hold()).status).toBe("authorized");
      expect((await notifications())[0].outcome).toBe("approved_left_to_capture");
    });
  });

  describe("idempotencia (AC6)", () => {
    it("la misma notificación dos veces: una sola transición, un solo aviso", async () => {
      await seedHold();
      mp.getPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "expired" }));

      const first = await notify({ notificationId: 42 });
      const second = await notify({ notificationId: 42 });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(await notifications()).toHaveLength(1);
      expect(mp.getPayment).toHaveBeenCalledTimes(1);
      expect(shipments.notifyHoldEvent).toHaveBeenCalledTimes(1);
    });

    it("dos notificaciones distintas del mismo cambio: un solo aviso", async () => {
      await seedHold();
      mp.getPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "expired" }));

      await notify({ notificationId: 1 });
      await notify({ notificationId: 2 });

      const rows = await notifications();
      expect(rows.map((r) => r.outcome)).toEqual(["hold_expired_notified:awaiting_payment", "hold_already_cancelled"]);
      expect(shipments.notifyHoldEvent).toHaveBeenCalledTimes(1);
    });

    it("las dos a la vez tampoco duplican la transición", async () => {
      await seedHold();
      mp.getPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "expired" }));
      await Promise.all([notify({ notificationId: 1 }), notify({ notificationId: 2 })]);
      expect(shipments.notifyHoldEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe("contracargos y reembolsos externos (AC5)", () => {
    it("registra el contracargo y alerta una sola vez aunque lleguen dos notificaciones", async () => {
      const seeded = await seedHold({ status: "captured", statusDetail: "accredited", expiresAt: null });
      mp.getPayment.mockImplementation(async () =>
        payment({ status: "charged_back", status_detail: "settled", transaction_amount_refunded: 1150 })
      );

      await notify({ notificationId: 1 });
      await notify({ notificationId: 2 });

      const events = await app.db.paymentProviderEvent.findMany();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        holdId: seeded.id,
        shipmentId: SHIPMENT,
        mpPaymentId: PAYMENT_ID,
        kind: "chargeback",
        mpStatus: "charged_back",
        holdStatus: "captured",
      });
      expect(events[0].amountArs?.toNumber()).toBe(1150);
      expect(events[0].alertedAt).not.toBeNull();
      expect(alerts.send).toHaveBeenCalledTimes(1);
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "mp_chargeback" }));
      // El hold no cambia: qué pasa con el envío es de disputas (MOVO-30/34).
      expect((await hold()).status).toBe("captured");
      expect(shipments.notifyHoldEvent).not.toHaveBeenCalled();
    });

    it("un reembolso hecho por fuera de Movo se registra como refund", async () => {
      await seedHold({ status: "captured", statusDetail: "accredited", expiresAt: null });
      mp.getPayment.mockImplementation(async () => payment({ status: "refunded", status_detail: "refunded" }));
      await notify();
      const [event] = await app.db.paymentProviderEvent.findMany();
      expect(event.kind).toBe("refund");
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "mp_refund" }));
    });

    // MOVO-336 (AC7): el reembolso de una disputa resuelta lo pide Movo, no es "externo".
    async function seedMovoRefund(amountArs: number, status: "processing" | "succeeded" | "failed" = "succeeded") {
      const held = await hold();
      const settlement = await app.db.settlement.create({
        data: {
          shipmentId: SHIPMENT,
          holdId: held.id,
          carrierId: CARRIER,
          mpPaymentId: PAYMENT_ID,
          grossAmountArs: 1150,
          commissionArs: 150,
          status: "credited",
        },
      });
      await addMovoRefund(settlement.id, 1, amountArs, status);
    }

    async function addMovoRefund(
      settlementId: string,
      attempt: number,
      amountArs: number,
      status: "processing" | "succeeded" | "failed" = "succeeded"
    ) {
      const held = await hold();
      await app.db.refund.create({
        data: {
          settlementId,
          shipmentId: SHIPMENT,
          holdId: held.id,
          carrierId: CARRIER,
          mpPaymentId: PAYMENT_ID,
          attempt,
          amountArs,
          reason: "Disputa resuelta a favor del emisor",
          requestKey: `dispute-${attempt}`,
          requestFingerprint: "fp",
          adminId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          mpIdempotencyKey: `movo-refund-${settlementId}-${attempt}`,
          status,
        },
      });
    }

    const refundRows = () => app.db.refund.findMany({ orderBy: { attempt: "asc" } });

    it("un reembolso iniciado por Movo no se registra como evento externo ni se alerta (MOVO-336)", async () => {
      await seedHold({ status: "captured", statusDetail: "accredited", expiresAt: null });
      await seedMovoRefund(1150);
      mp.getPayment.mockImplementation(async () =>
        payment({ status: "refunded", status_detail: "refunded", transaction_amount_refunded: 1150 })
      );

      await notify();

      expect(await app.db.paymentProviderEvent.count()).toBe(0);
      expect(alerts.send).not.toHaveBeenCalled();
      expect((await notifications())[0].outcome).toBe("refund_initiated_by_movo");
    });

    it("un reembolso de Movo todavía en curso (processing) también se reconoce como propio (MOVO-336)", async () => {
      await seedHold({ status: "captured", statusDetail: "accredited", expiresAt: null });
      await seedMovoRefund(1150, "processing");
      mp.getPayment.mockImplementation(async () =>
        payment({ status: "refunded", status_detail: "refunded", transaction_amount_refunded: 1150 })
      );

      await notify();

      expect(alerts.send).not.toHaveBeenCalled();
      // Y como MP ya informa el monto devuelto, el intento deja de estar "en curso": pasa a succeeded.
      const [row] = await refundRows();
      expect(row.status).toBe("succeeded");
      expect(row.completedAt).not.toBeNull();
    });

    // MOVO-336 (review de PR #314): nadie más cierra un intento que MP aceptó `in_process` o cuya respuesta se perdió.
    it("un reembolso PARCIAL confirmado por MP (el pago sigue approved) promueve el intento processing a succeeded", async () => {
      await seedHold({ status: "captured", statusDetail: "accredited", expiresAt: null });
      await seedMovoRefund(300, "processing");
      mp.getPayment.mockImplementation(async () =>
        payment({ status: "approved", status_detail: "accredited", transaction_amount_refunded: 300 })
      );

      await notify();

      const [row] = await refundRows();
      expect(row.status).toBe("succeeded");
      expect(row.completedAt).not.toBeNull();
      expect(await app.db.paymentProviderEvent.count()).toBe(0);
      expect(alerts.send).not.toHaveBeenCalled();
    });

    it("si MP informa menos de lo que pedía el intento, sigue processing", async () => {
      await seedHold({ status: "captured", statusDetail: "accredited", expiresAt: null });
      await seedMovoRefund(500, "processing");
      mp.getPayment.mockImplementation(async () =>
        payment({ status: "approved", status_detail: "accredited", transaction_amount_refunded: 300 })
      );

      await notify();

      expect((await refundRows())[0].status).toBe("processing");
    });

    it("con varios intentos processing promueve los más viejos que entran en lo que MP informa", async () => {
      await seedHold({ status: "captured", statusDetail: "accredited", expiresAt: null });
      await seedMovoRefund(300, "processing");
      const [first] = await refundRows();
      await addMovoRefund(first.settlementId, 2, 200, "processing");
      mp.getPayment.mockImplementation(async () =>
        payment({ status: "approved", status_detail: "accredited", transaction_amount_refunded: 300 })
      );

      await notify();

      expect((await refundRows()).map((r) => r.status)).toEqual(["succeeded", "processing"]);
    });

    it("un intento fallido no se promueve aunque MP informe un reembolso de ese monto", async () => {
      await seedHold({ status: "captured", statusDetail: "accredited", expiresAt: null });
      await seedMovoRefund(300, "failed");
      mp.getPayment.mockImplementation(async () =>
        payment({ status: "approved", status_detail: "accredited", transaction_amount_refunded: 300 })
      );

      await notify();

      expect((await refundRows())[0].status).toBe("failed");
    });

    it("si MP informa más de lo que pidió Movo, el resto sigue siendo un reembolso externo (MOVO-336)", async () => {
      await seedHold({ status: "captured", statusDetail: "accredited", expiresAt: null });
      await seedMovoRefund(500);
      mp.getPayment.mockImplementation(async () =>
        payment({ status: "refunded", status_detail: "refunded", transaction_amount_refunded: 1150 })
      );

      await notify();

      const [event] = await app.db.paymentProviderEvent.findMany();
      expect(event.kind).toBe("refund");
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "mp_refund" }));
    });

    it("un reembolso de Movo fallido no cuenta: el de MP sigue siendo externo (MOVO-336)", async () => {
      await seedHold({ status: "captured", statusDetail: "accredited", expiresAt: null });
      await seedMovoRefund(1150, "failed");
      mp.getPayment.mockImplementation(async () =>
        payment({ status: "refunded", status_detail: "refunded", transaction_amount_refunded: 1150 })
      );

      await notify();

      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "mp_refund" }));
    });
  });

  // MOVO-302 (review de PR #255): el webhook completa la tarjeta del hold aunque el estado no cambie.
  describe("tarjeta del pago en el webhook (MOVO-302)", () => {
    const withCard = (overrides: Partial<PaymentResponse> = {}) =>
      payment({ payment_method_id: "visa", card: { last_four_digits: "4242" }, ...overrides } as Partial<PaymentResponse>);

    it("estado sin cambios (no_change): igual completa los últimos 4 que faltaban", async () => {
      // Un hold adoptado solo con la marca, y después llega el webhook con la tarjeta y el mismo estado.
      await seedHold({ status: "authorized", cardBrand: "visa", cardLast4: null });
      mp.getPayment.mockImplementation(async () => withCard());

      await notify();

      const row = await hold();
      expect(row.status).toBe("authorized");
      expect(row.cardLast4).toBe("4242");
      expect((await notifications())[0].outcome).toBe("no_change");
    });

    // MOVO-285 (review de PR #301): el fee real de MP, igual que la tarjeta, se completa aunque el estado no cambie.
    it("MOVO-285: estado sin cambios (no_change): igual completa el fee de MP que faltaba", async () => {
      await seedHold({ status: "authorized" });
      mp.getPayment.mockImplementation(async () =>
        payment({ charges_details: [{ name: "mercadopago_fee", accounts: { from: "collector" }, amounts: { original: 47.15 } }] } as Partial<PaymentResponse>)
      );

      await notify();

      const row = await hold();
      expect(row.status).toBe("authorized");
      expect(Number(row.mpFeeArs)).toBe(47.15);
      expect((await notifications())[0].outcome).toBe("no_change");
    });

    it("MOVO-285: no pisa un fee que el hold ya tenía", async () => {
      await seedHold({ status: "authorized", mpFeeArs: 40 });
      mp.getPayment.mockImplementation(async () =>
        payment({ charges_details: [{ name: "mercadopago_fee", accounts: { from: "collector" }, amounts: { original: 47.15 } }] } as Partial<PaymentResponse>)
      );

      await notify();

      expect(Number((await hold()).mpFeeArs)).toBe(40);
    });

    it("no pisa una tarjeta que el hold ya tenía", async () => {
      await seedHold({ cardBrand: "master", cardLast4: "1881" });
      mp.getPayment.mockImplementation(async () => withCard());

      await notify();

      expect(await hold()).toMatchObject({ cardBrand: "master", cardLast4: "1881" });
    });

    it("un reembolso por fuera de Movo también la completa (corta antes de transitionHold)", async () => {
      await seedHold({ status: "captured", statusDetail: "accredited", expiresAt: null });
      mp.getPayment.mockImplementation(async () => withCard({ status: "refunded", status_detail: "refunded" }));

      await notify();

      expect(await hold()).toMatchObject({ cardLast4: "4242", cardBrand: "visa" });
      expect(await app.db.paymentProviderEvent.findMany()).toHaveLength(1);
    });

    it("un intento en creating rescatado por el webhook queda con la tarjeta aunque la búsqueda no la traiga", async () => {
      await seedHold({ status: "creating", mpPaymentId: null, statusDetail: null, expiresAt: null });
      mp.searchPaymentsByExternalReference.mockImplementation(async () => [
        { id: Number(PAYMENT_ID), status: "authorized" },
      ]);
      mp.getPayment.mockImplementation(async () => withCard());

      await notify();

      const adopted = await hold();
      expect(adopted.status).toBe("authorized");
      expect(adopted).toMatchObject({ cardLast4: "4242", cardBrand: "visa" });
    });
  });

  describe("pagos que no son de Movo o no se pueden verificar", () => {
    it("un pago desconocido de un vendedor no vinculado se ignora sin consultar a MP", async () => {
      await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.carrier_mp_accounts");
      await notify();
      expect(mp.getPayment).not.toHaveBeenCalled();
      expect((await notifications())[0]).toMatchObject({ status: "ignored", outcome: "unknown_payment" });
    });

    it("un pago del vendedor sin hold asociado (otro integrador) se ignora", async () => {
      mp.getPayment.mockImplementation(async () => payment({ external_reference: "no-es-un-envio" }));
      await notify();
      expect((await notifications())[0]).toMatchObject({ status: "ignored", outcome: "unknown_payment" });
    });

    it("rescata un intento en creating cuyo pago llega por el webhook", async () => {
      await seedHold({ status: "creating", mpPaymentId: null, statusDetail: null, expiresAt: null });
      mp.searchPaymentsByExternalReference.mockImplementation(async () => [
        { id: Number(PAYMENT_ID), status: "authorized" },
      ]);
      await notify();
      const adopted = await hold();
      expect(adopted.status).toBe("authorized");
      expect(adopted.mpPaymentId).toBe(PAYMENT_ID);
    });

    it("transportista desvinculado: queda unverifiable y alerta", async () => {
      await seedHold();
      await createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).unlink(CARRIER, new Date());
      await notify();
      expect(mp.getPayment).not.toHaveBeenCalled();
      expect((await notifications())[0]).toMatchObject({
        status: "unverifiable",
        outcome: "carrier_credentials_missing",
      });
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "mp_webhook_unverifiable" }));
      expect((await hold()).status).toBe("authorized");
    });

    it("MP rechaza el token del transportista: unverifiable", async () => {
      await seedHold();
      mp.getPayment.mockImplementation(async () => {
        throw { status: 401, message: "invalid access token" };
      });
      await notify();
      expect((await notifications())[0]).toMatchObject({ status: "unverifiable", outcome: "carrier_token_rejected" });
    });
  });

  describe("hardening de la review de PR #235", () => {
    it("reenviar una notificación firmada con otro `id` en el body NO crea una fila nueva (se deduplica por lo firmado)", async () => {
      await seedHold();
      await replay({ id: 1 });
      await replay({ id: 999 });
      await replay({ id: 12345 });

      expect(await notifications()).toHaveLength(1);
    });

    it("un `status` heredado de Object (constructor, toString) no rompe: queda como estado desconocido", async () => {
      await seedHold();
      mp.getPayment.mockImplementation(async () => payment({ status: "constructor" }));

      await notify();

      const [row] = await notifications();
      expect(row).toMatchObject({ status: "processed", outcome: "unknown_mp_status:constructor" });
      expect(await app.db.paymentProviderEvent.count()).toBe(0);
    });

    it("un `user_id` forjado que apunta a otro vendedor se ignora si el pago no es de ese vendedor", async () => {
      // Pago desconocido (sin hold): el body trae el user_id del transportista, pero MP dice que el cobrador es otro.
      mp.getPayment.mockImplementation(async () => ({ ...payment(), collector_id: 555 }) as PaymentResponse);

      await notify();

      expect((await notifications())[0]).toMatchObject({ status: "ignored", outcome: "unknown_payment_collector_mismatch" });
    });

    it("un intento en creating que la reconciliación lleva a cancelado SÍ le avisa a svc-shipments", async () => {
      await seedHold({ status: "creating", mpPaymentId: null, statusDetail: null, expiresAt: null });
      // MP todavía lo tiene vivo al buscarlo (se adopta), pero al sincronizar ya figura vencido.
      mp.searchPaymentsByExternalReference.mockImplementation(async () => [
        { id: Number(PAYMENT_ID), status: "authorized" },
      ]);
      mp.getPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "expired" }));

      await notify();

      expect((await hold()).status).toBe("cancelled");
      expect(shipments.notifyHoldEvent).toHaveBeenCalledWith(
        SHIPMENT,
        expect.objectContaining({ event: "expired", statusDetail: "expired" })
      );
      const [row] = await notifications();
      expect(row.outcome).toMatch(/^hold_expired_notified/);
      expect(row.pendingHoldEvent).toBeNull();
    });

    it("si svc-shipments no responde tras reconciliar, el aviso queda pendiente y el reintento lo entrega", async () => {
      const seeded = await seedHold({ status: "creating", mpPaymentId: null, statusDetail: null, expiresAt: null });
      mp.searchPaymentsByExternalReference.mockImplementation(async () => [
        { id: Number(PAYMENT_ID), status: "authorized" },
      ]);
      mp.getPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "cancelled_by_user" }));
      shipments.notifyHoldEvent.mockImplementationOnce(async () => {
        throw new ShipmentsUnavailableError("svc-shipments respondió 503");
      });

      await notify();
      const [pending] = await notifications();
      expect(pending).toMatchObject({ status: "pending", pendingHoldEvent: "cancelled", holdId: seeded.id });

      await app.db.$executeRawUnsafe(
        "UPDATE payments.mp_webhook_notifications SET next_attempt_at = now() - interval '1 second'"
      );
      await app.mpWebhooks.processDue();

      expect(shipments.notifyHoldEvent).toHaveBeenCalledTimes(2);
      expect((await notifications())[0]).toMatchObject({ status: "processed", pendingHoldEvent: null });
    });
  });

  describe("reintentos (AC7)", () => {
    const makeDue = () =>
      app.db.$executeRawUnsafe("UPDATE payments.mp_webhook_notifications SET next_attempt_at = now() - interval '1 second'");

    it("MP caído: responde 200 igual y deja la notificación pendiente con backoff", async () => {
      await seedHold();
      mp.getPayment.mockImplementation(async () => {
        throw { status: 500, message: "internal error" };
      });

      const res = await notify();

      expect(res.statusCode).toBe(200);
      const [row] = await notifications();
      expect(row).toMatchObject({ status: "pending", outcome: "retry_scheduled", attempts: 1 });
      expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("svc-shipments caído: el hold ya cambió y el reintento solo vuelve a avisar", async () => {
      const seeded = await seedHold();
      mp.getPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "expired" }));
      shipments.notifyHoldEvent.mockImplementationOnce(async () => {
        throw new ShipmentsUnavailableError("svc-shipments respondió 503");
      });

      await notify();
      let [row] = await notifications();
      expect((await hold()).status).toBe("cancelled");
      expect(row).toMatchObject({ status: "pending", pendingHoldEvent: "expired", holdId: seeded.id });

      await makeDue();
      expect(await app.mpWebhooks.processDue()).toBe(1);

      [row] = await notifications();
      expect(row).toMatchObject({ status: "processed", pendingHoldEvent: null, attempts: 2 });
      expect(shipments.notifyHoldEvent).toHaveBeenCalledTimes(2);
      // El reintento no vuelve a consultar a MP: el hold ya refleja el cambio.
      expect(mp.getPayment).toHaveBeenCalledTimes(1);
    });

    it("al agotar los intentos queda failed y alerta", async () => {
      await seedHold();
      mp.getPayment.mockImplementation(async () => {
        throw { status: 500, message: "internal error" };
      });
      await notify();
      await app.db.$executeRawUnsafe(
        `UPDATE payments.mp_webhook_notifications SET attempts = ${app.config.MP_WEBHOOK_MAX_ATTEMPTS - 1}`
      );
      await makeDue();

      await app.mpWebhooks.processDue();

      const [row] = await notifications();
      expect(row).toMatchObject({ status: "failed", outcome: "max_attempts_reached" });
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "mp_webhook_failed" }));
    });

    it("el barrido no toma una notificación que todavía no venció", async () => {
      await seedHold();
      mp.getPayment.mockImplementation(async () => {
        throw { status: 500, message: "internal error" };
      });
      await notify();
      expect(await app.mpWebhooks.processDue()).toBe(0);
    });
  });
});
