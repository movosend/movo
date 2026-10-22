import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { AlertNotifier } from "../src/adapters/alert-notifier";
import type { MercadoPagoClient, PaymentResponse } from "../src/adapters/mercadopago-client";
import type { ShipmentsClient } from "../src/adapters/shipments-client";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../src/utils/token-cipher";

// MOVO-213: reintentos de la captura y escalado. Postgres y Redis reales; solo se reemplazan MP, las alertas y
// el aviso a svc-shipments. El reloj es el real: para "que llegue la hora" se adelanta `next_attempt_at` en la base.

const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
const MP_PAYMENT = "1352823085";
const CAPTURE = `/internal/payments/holds/by-shipment/${SHIPMENT}/capture`;
const DAY = 86_400_000;

function payment(overrides: Record<string, unknown> = {}): PaymentResponse {
  return {
    id: Number(MP_PAYMENT),
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 1000,
    fee_details: [
      { type: "mercadopago_fee", amount: 41, fee_payer: "collector" },
      { type: "application_fee", amount: 150, fee_payer: "collector" },
    ],
    transaction_details: { net_received_amount: 809 },
    ...overrides,
  } as unknown as PaymentResponse;
}

const authorized = () => payment({ status: "authorized", status_detail: "pending_capture", fee_details: [] });

describe("reintentos de la captura y escalado (MOVO-213)", () => {
  let app: FastifyInstance;
  const mp = {
    createPayment: vi.fn(),
    getPayment: vi.fn(),
    capturePayment: vi.fn(),
    cancelPayment: vi.fn(),
    searchPaymentsByExternalReference: vi.fn(async () => []),
  };
  const alerts = { send: vi.fn(async () => undefined) };
  const shipments = {
    notifyHoldEvent: vi.fn(),
    resolveLedgerOrigins: vi.fn(async () => []),
    notifySettlementEvent: vi.fn(async () => ({ handled: true, outcome: "ok" })),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    app = buildApp({
      mercadoPagoClient: mp as unknown as MercadoPagoClient,
      alertNotifier: alerts as unknown as AlertNotifier,
      shipmentsClient: shipments as unknown as ShipmentsClient,
      captureRetrySweepEnabled: false,
      mpTokenRefreshSweepEnabled: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.MP_TOKEN_ENCRYPTION_KEY;
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.settlements, payments.holds, payments.carrier_mp_accounts CASCADE");
    mp.capturePayment.mockReset().mockImplementation(async () => payment());
    mp.getPayment.mockReset().mockImplementation(async () => authorized());
    alerts.send.mockClear();
    shipments.notifySettlementEvent.mockClear();
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
        tokenExpiresAt: new Date(Date.now() + DAY),
      },
      new Date()
    );
  });

  const seedHold = (overrides: { expiresAt?: Date | null; status?: "authorized" | "cancelled" } = {}) =>
    app.db.hold.create({
      data: {
        shipmentId: SHIPMENT,
        attempt: 1,
        carrierId: CARRIER,
        collectorId: "1000000001",
        mpPaymentId: MP_PAYMENT,
        amountArs: 1000,
        applicationFeeArs: 150,
        baseAmountArs: 1000,
        commissionArs: 150,
        status: overrides.status ?? "authorized",
        expiresAt: overrides.expiresAt === undefined ? new Date(Date.now() + DAY) : overrides.expiresAt,
      },
    });

  const settlement = () => app.db.settlement.findUniqueOrThrow({ where: { shipmentId: SHIPMENT } });
  const capture = () => app.inject({ method: "POST", url: CAPTURE });
  /** Llega la hora del reintento programado. */
  const makeDue = () =>
    app.db.settlement.updateMany({ where: { shipmentId: SHIPMENT }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
  /** MP no responde: la captura falla con 500 y el pago sigue sin capturar. */
  const mpTimesOut = () => mp.capturePayment.mockRejectedValue({ status: 500, message: "timeout" });

  it("AC1: una captura fallida queda pendiente de reintento, con motivo, intentos y próxima hora", async () => {
    await seedHold();
    mpTimesOut();

    const res = await capture();

    expect(res.statusCode).toBe(502);
    const row = await settlement();
    expect(row).toMatchObject({ status: "failed", failureReason: "provider_error", attempts: 1, escalatedAt: null });
    expect(row.lastError).toContain("HTTP 500");
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
  });

  it("AC2: reintenta con backoff (5, 30 y 120 min) y, agotados los tres reintentos, escala", async () => {
    await seedHold();
    mpTimesOut();
    await capture();

    for (const expectedAttempts of [2, 3]) {
      await makeDue();
      const run = await app.captureRetry.runOnce();
      expect(run).toMatchObject({ attempted: 1, failed: 1 });
      const row = await settlement();
      expect(row).toMatchObject({ status: "failed", attempts: expectedAttempts });
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    }
    // La espera previa al tercer reintento es la de 120 min.
    expect((await settlement()).nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 110 * 60_000);

    await makeDue();
    await app.captureRetry.runOnce();

    expect(await settlement()).toMatchObject({
      status: "escalated",
      attempts: 4,
      escalationReason: "retries_exhausted",
      nextAttemptAt: null,
    });
    expect((await settlement()).escalatedAt).not.toBeNull();
    // Intento inicial + 3 reintentos, y no uno más.
    expect(mp.capturePayment).toHaveBeenCalledTimes(4);
  });

  it("otro pedido de captura no adelanta un reintento programado", async () => {
    await seedHold();
    mpTimesOut();
    await capture();
    mp.capturePayment.mockClear();

    const res = await capture();

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("SETTLEMENT_RETRY_PENDING");
    expect(mp.capturePayment).not.toHaveBeenCalled();
    expect((await settlement()).attempts).toBe(1);
  });

  it("AC3: si el timeout ocultaba una captura que SÍ ocurrió, el reintento consulta el pago y no vuelve a capturar", async () => {
    await seedHold();
    mpTimesOut();
    await capture();
    expect(mp.capturePayment).toHaveBeenCalledTimes(1);
    // MP había capturado: ahora el pago figura aprobado con su desglose.
    mp.getPayment.mockImplementation(async () => payment());
    await makeDue();

    const run = await app.captureRetry.runOnce();

    expect(run).toMatchObject({ attempted: 1, credited: 1 });
    expect(mp.capturePayment).toHaveBeenCalledTimes(1);
    expect(await settlement()).toMatchObject({ status: "credited", netAmountArs: expect.anything() });
    expect(await app.db.hold.findFirstOrThrow({ where: { shipmentId: SHIPMENT } })).toMatchObject({ status: "captured" });
    // El envío puede pasar a completed: se le avisa a shipments.
    expect(shipments.notifySettlementEvent).toHaveBeenCalledWith(SHIPMENT, "credited");
    expect(alerts.send).not.toHaveBeenCalled();
  });

  it("AC3: si no se puede consultar el pago, no se captura a ciegas: el intento falla y se reprograma", async () => {
    await seedHold();
    mpTimesOut();
    await capture();
    mp.getPayment.mockRejectedValue({ status: 503 });
    mp.capturePayment.mockClear();
    await makeDue();

    await app.captureRetry.runOnce();

    expect(mp.capturePayment).not.toHaveBeenCalled();
    expect(await settlement()).toMatchObject({ status: "failed", attempts: 2 });
  });

  it("AC4: la cuenta del transportista rechazada escala de inmediato, sin gastar intentos", async () => {
    await seedHold();
    mp.capturePayment.mockRejectedValue({ status: 401, message: "unauthorized" });
    mp.getPayment.mockRejectedValue({ status: 401 });

    const res = await capture();

    expect(res.statusCode).toBe(409);
    expect(await settlement()).toMatchObject({
      status: "escalated",
      failureReason: "carrier_account_unavailable",
      escalationReason: "not_retryable",
      attempts: 0,
      nextAttemptAt: null,
    });
    expect(mp.capturePayment).toHaveBeenCalledTimes(1);
  });

  it("AC4: un hold que MP canceló escala de inmediato", async () => {
    await seedHold();
    mp.capturePayment.mockRejectedValue({ status: 400, message: "cancelled" });
    mp.getPayment.mockImplementation(async () => payment({ status: "cancelled", fee_details: [] }));

    await capture();

    expect(await settlement()).toMatchObject({ status: "escalated", failureReason: "hold_expired", attempts: 0 });
  });

  it("AC4: si el reintento encuentra el hold cancelado por MP (webhook), escala en vez de dar vueltas", async () => {
    await seedHold();
    mpTimesOut();
    await capture();
    await app.db.hold.updateMany({ where: { shipmentId: SHIPMENT }, data: { status: "cancelled" } });
    await makeDue();

    await app.captureRetry.runOnce();

    expect(await settlement()).toMatchObject({ status: "escalated", escalationReason: "not_retryable" });
    expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "settlement_escalated" }));
  });

  it("AC5: al escalar se alerta al equipo con lo necesario para resolverlo a mano", async () => {
    await seedHold();
    mp.capturePayment.mockRejectedValue({ status: 401, message: "unauthorized" });
    mp.getPayment.mockRejectedValue({ status: 401 });

    await capture();

    expect(alerts.send).toHaveBeenCalledTimes(1);
    expect(alerts.send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "settlement_escalated",
        context: expect.objectContaining({
          shipmentId: SHIPMENT,
          carrierId: CARRIER,
          mpPaymentId: MP_PAYMENT,
          failureReason: "carrier_account_unavailable",
          escalationReason: "not_retryable",
        }),
      })
    );
  });

  it("AC5: aunque la alerta falle, la liquidación queda escalada y se avisa igual al transportista", async () => {
    await seedHold();
    mp.capturePayment.mockRejectedValue({ status: 401, message: "unauthorized" });
    mp.getPayment.mockRejectedValue({ status: 401 });
    alerts.send.mockRejectedValueOnce(new Error("telegram caído"));

    await capture();

    expect((await settlement()).status).toBe("escalated");
    expect(shipments.notifySettlementEvent).toHaveBeenCalledWith(SHIPMENT, "delayed");
  });

  it("AC7: al escalar se le avisa a shipments que el cobro está demorado (una vez)", async () => {
    await seedHold();
    mp.capturePayment.mockRejectedValue({ status: 401, message: "unauthorized" });
    mp.getPayment.mockRejectedValue({ status: 401 });

    await capture();
    await capture();

    expect(shipments.notifySettlementEvent).toHaveBeenCalledTimes(1);
    expect(shipments.notifySettlementEvent).toHaveBeenCalledWith(SHIPMENT, "delayed");
  });

  it("una liquidación escalada por reintentos agotados no se vuelve a capturar sola", async () => {
    await seedHold();
    mpTimesOut();
    await capture();
    for (let i = 0; i < 3; i += 1) {
      await makeDue();
      await app.captureRetry.runOnce();
    }
    expect((await settlement()).status).toBe("escalated");
    mp.capturePayment.mockClear();

    const res = await capture();

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("SETTLEMENT_ESCALATED");
    expect(mp.capturePayment).not.toHaveBeenCalled();
  });

  it("AC8: un hold con expires_at vencido escala de inmediato, sin consumir intentos ni llamar a MP", async () => {
    await seedHold({ expiresAt: new Date(Date.now() - 60_000) });

    const res = await capture();

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("HOLD_NOT_CAPTURABLE");
    expect(await settlement()).toMatchObject({
      status: "escalated",
      failureReason: "hold_expired",
      escalationReason: "not_retryable",
      attempts: 0,
    });
    expect(mp.getPayment).not.toHaveBeenCalled();
    expect(mp.capturePayment).not.toHaveBeenCalled();
    expect(alerts.send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "settlement_escalated",
        context: expect.objectContaining({ holdExpiresAt: expect.any(String) }),
      })
    );
  });

  it("AC8: el vencimiento se mira antes de CADA reintento: con el pago aún sin capturar en MP, escala sin capturar", async () => {
    await seedHold();
    mpTimesOut();
    await capture();
    await app.db.hold.updateMany({ where: { shipmentId: SHIPMENT }, data: { expiresAt: new Date(Date.now() - 1000) } });
    mp.capturePayment.mockClear();
    mp.getPayment.mockClear();
    await makeDue();

    await app.captureRetry.runOnce();

    // Hubo un intento anterior: se consulta el pago (puede haberse capturado), pero `authorized` + vencido no se captura.
    expect(mp.getPayment).toHaveBeenCalledTimes(1);
    expect(mp.capturePayment).not.toHaveBeenCalled();
    expect(await settlement()).toMatchObject({ status: "escalated", failureReason: "hold_expired", attempts: 1 });
  });

  it("review: una captura que MP SÍ aprobó no se escala como vencida aunque expires_at ya haya pasado", async () => {
    // Intento anterior ambiguo: MP capturó pero el servicio no pudo leer el desglose; el hold sigue `authorized` en la base.
    await seedHold();
    mpTimesOut();
    await capture();
    await app.db.hold.updateMany({ where: { shipmentId: SHIPMENT }, data: { expiresAt: new Date(Date.now() - 1000) } });
    mp.getPayment.mockImplementation(async () => payment());
    mp.capturePayment.mockClear();
    await makeDue();

    const run = await app.captureRetry.runOnce();

    expect(run).toMatchObject({ attempted: 1, credited: 1 });
    expect(mp.capturePayment).not.toHaveBeenCalled();
    expect(await settlement()).toMatchObject({ status: "credited", failureReason: null });
    expect(shipments.notifySettlementEvent).toHaveBeenCalledWith(SHIPMENT, "credited");
    expect(alerts.send).not.toHaveBeenCalled();
  });

  it("review: un hold vencido que MP ya canceló escala como vencido tras consultar el pago", async () => {
    await seedHold();
    mpTimesOut();
    await capture();
    await app.db.hold.updateMany({ where: { shipmentId: SHIPMENT }, data: { expiresAt: new Date(Date.now() - 1000) } });
    mp.getPayment.mockImplementation(async () => payment({ status: "cancelled", fee_details: [] }));
    await makeDue();

    await app.captureRetry.runOnce();

    expect(await settlement()).toMatchObject({ status: "escalated", failureReason: "hold_expired" });
  });

  it("un hold ya capturado no se descarta por su expires_at: solo falta completar la liquidación", async () => {
    await seedHold({ expiresAt: new Date(Date.now() - 60_000) });
    await app.db.hold.updateMany({ where: { shipmentId: SHIPMENT }, data: { status: "captured" } });
    mp.getPayment.mockImplementation(async () => payment());

    const res = await capture();

    expect(res.statusCode).toBe(200);
    expect(mp.capturePayment).not.toHaveBeenCalled();
  });

  it("AC6: las liquidaciones pendientes y escaladas son consultables, paginadas", async () => {
    await seedHold();
    mpTimesOut();
    await capture();
    const list = (query: string) =>
      app.inject({ method: "GET", url: `/internal/payments/settlements?${query}` });

    const pending = await list("status=failed");
    expect(pending.statusCode).toBe(200);
    expect(pending.json().items).toEqual([
      expect.objectContaining({ shipmentId: SHIPMENT, status: "failed", attempts: 1, failureReason: "provider_error" }),
    ]);
    expect((await list("status=escalated")).json().items).toEqual([]);

    // Se agotan los reintentos.
    for (let i = 0; i < 3; i += 1) {
      await makeDue();
      await app.captureRetry.runOnce();
    }
    const escalated = (await list("status=escalated")).json();
    expect(escalated.items).toHaveLength(1);
    expect(escalated.items[0]).toMatchObject({
      status: "escalated",
      escalationReason: "retries_exhausted",
      attempts: 4,
      holdExpiresAt: expect.any(String),
      grossAmountArs: 1000,
    });
    expect(escalated.nextCursor).toBeNull();
    expect((await list("status=failed")).json().items).toEqual([]);
    expect((await list("status=credited")).statusCode).toBe(400);
  });

  it("review: las penalidades de cancelación `failed` no aparecen: las maneja shipments, no son un cobro demorado", async () => {
    await seedHold();
    await app.db.settlement.create({
      data: {
        shipmentId: SHIPMENT, holdId: (await app.db.hold.findFirstOrThrow({ where: { shipmentId: SHIPMENT } })).id, carrierId: CARRIER,
        mpPaymentId: MP_PAYMENT, grossAmountArs: 300, commissionArs: 150, status: "failed", kind: "cancellation_penalty",
        failureReason: "provider_error",
      },
    });

    const res = await app.inject({ method: "GET", url: "/internal/payments/settlements?status=failed" });

    expect(res.json().items).toEqual([]);
  });

  it("AC6: el listado recorre más de una página con el cursor", async () => {
    const insert = (shipmentId: string, minutesAgo: number) =>
      app.db.$executeRawUnsafe(
        `INSERT INTO payments.settlements (shipment_id, hold_id, carrier_id, mp_payment_id, gross_amount_ars, commission_ars, status, updated_at)
         SELECT $1::uuid, h.id, h.carrier_id, 'p', 1000, 150, 'escalated', now() - ($2 || ' minutes')::interval
         FROM payments.holds h WHERE h.shipment_id = $1::uuid`,
        shipmentId,
        String(minutesAgo)
      );
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
    for (const [i, shipmentId] of ids.entries()) {
      await app.db.hold.create({
        data: {
          shipmentId, attempt: 1, carrierId: CARRIER, collectorId: "1", mpPaymentId: `p${i}`, amountArs: 1000,
          applicationFeeArs: 150, baseAmountArs: 1000, commissionArs: 150, status: "authorized",
        },
      });
      await insert(shipmentId, i);
    }

    const first = (await app.inject({ method: "GET", url: "/internal/payments/settlements?status=escalated&limit=2" })).json();
    expect(first.items.map((i: { shipmentId: string }) => i.shipmentId)).toEqual([ids[0], ids[1]]);
    const second = (
      await app.inject({ method: "GET", url: `/internal/payments/settlements?status=escalated&limit=2&cursor=${first.nextCursor}` })
    ).json();
    expect(second.items.map((i: { shipmentId: string }) => i.shipmentId)).toEqual([ids[2]]);
    expect(second.nextCursor).toBeNull();
  });
});
