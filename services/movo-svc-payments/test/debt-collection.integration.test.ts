import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { MercadoPagoClient, PaymentResponse } from "../src/adapters/mercadopago-client";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { createTokenCipher } from "../src/utils/token-cipher";
import { createBalancePaymentAttemptRepository } from "../src/repositories/balance-payment-attempt-repository";
import { createUserLedgerRepository, readBalanceNetOfReservations } from "../src/repositories/user-ledger-repository";
import { Prisma } from "../src/generated/prisma/client";

// MOVO-311: la deuda de la cuenta corriente se cobra en el `application_fee` del hold. Postgres y Redis
// reales; solo se reemplaza el cliente de MP. Precio 1150 (comisión 150), tope 30% = 345.

const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIPMENT_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_CARRIER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PAYER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
const HOLDS = "/internal/payments/holds";
const USERS = "/internal/payments/users";

function payment(overrides: Partial<PaymentResponse> = {}): PaymentResponse {
  return { id: 1352823085, status: "authorized", status_detail: "pending_capture", ...overrides } as PaymentResponse;
}

describe("deuda de la cuenta corriente cobrada en el hold (MOVO-311)", () => {
  let app: FastifyInstance;
  let createCount = 0;
  let debtSeq = 0;
  const mp = {
    createPayment: vi.fn(async () => payment({ id: 1_000_000 + ++createCount })),
    getPayment: vi.fn(async () => payment()),
    capturePayment: vi.fn(async () => payment({ status: "approved" })),
    cancelPayment: vi.fn(async () => payment({ status: "cancelled", status_detail: "by_collector" })),
    searchPaymentsByExternalReference: vi.fn(async () => []),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    app = buildApp({ mercadoPagoClient: mp as unknown as MercadoPagoClient });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.MP_TOKEN_ENCRYPTION_KEY;
  });

  async function link(userId: string, mpUserId: string) {
    await createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).upsertLinked(
      userId,
      {
        mpUserId,
        email: `${mpUserId}@example.com`,
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

  beforeEach(async () => {
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE payments.user_ledger_entries, payments.settlements, payments.holds, payments.carrier_mp_accounts, payments.balance_payment_attempts CASCADE"
    );
    createCount = 0;
    for (const fn of [mp.createPayment, mp.getPayment, mp.capturePayment, mp.cancelPayment]) fn.mockClear();
    mp.createPayment.mockImplementation(async () => payment({ id: 1_000_000 + ++createCount }));
    mp.getPayment.mockImplementation(async () => payment());
    mp.cancelPayment.mockImplementation(async () => payment({ status: "cancelled", status_detail: "by_collector" }));
    await link(CARRIER, "1000000001");
    await link(OTHER_CARRIER, "1000000002");
  });

  async function owe(userId: string, amountArs: number) {
    const res = await app.inject({
      method: "POST",
      url: `${USERS}/${userId}/ledger-entries`,
      payload: { idempotencyKey: `penalty-${++debtSeq}`, type: "cancellation_penalty", amountArs, roleAtOrigin: "carrier" },
    });
    expect(res.statusCode).toBe(201);
  }

  async function balanceOf(userId: string): Promise<number> {
    const res = await app.inject({ method: "GET", url: `${USERS}/${userId}/balance` });
    return res.json().balanceArs;
  }

  /** Lo que todavía no tomó ningún hold: el saldo menos las reservas (el que ve "Pagar mi saldo"). */
  async function unreservedOf(userId: string): Promise<number> {
    return (await readBalanceNetOfReservations(app.db, userId)).toNumber();
  }

  async function entriesOf(userId: string) {
    return app.db.userLedgerEntry.findMany({
      where: { userId, type: { in: ["fee_offset", "payment_surcharge"] } },
      orderBy: { createdAt: "asc" },
    });
  }

  const createHold = (overrides: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: HOLDS,
      payload: {
        shipmentId: SHIPMENT,
        carrierId: CARRIER,
        cardToken: "card-token-1",
        amountArs: 1150,
        payerEmail: "comprador@example.com",
        payerUserId: PAYER,
        paymentMethodId: "visa",
        ...overrides,
      },
    });

  it("transportista con deuda menor al tope: se descuenta toda del fee y queda reservada", async () => {
    await owe(CARRIER, 100);
    const res = await createHold();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ amountArs: 1150, applicationFeeArs: 250, commissionArs: 150, debtOffsetArs: 100 });

    const [, body] = mp.createPayment.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(body).toMatchObject({ transaction_amount: 1150, application_fee: 250 });
    const [entry] = await entriesOf(CARRIER);
    expect(entry).toMatchObject({ type: "fee_offset", status: "reserved", roleAtOrigin: "carrier", holdId: res.json().id });
    expect(entry.amountArs.toNumber()).toBe(-100);
    expect(await unreservedOf(CARRIER)).toBe(0);
    // El saldo que se informa (y mide el bloqueo por deuda) no baja mientras el hold es solo una reserva.
    expect(await balanceOf(CARRIER)).toBe(100);
    const summary = await app.inject({ method: "GET", url: `${USERS}/${CARRIER}/balance` });
    expect(summary.json().oldestUnpaidAt).not.toBeNull();
  });

  it("deuda mayor al tope: se descuenta el 30% del precio y el resto queda pendiente", async () => {
    await owe(CARRIER, 1000);
    const res = await createHold();
    expect(res.json()).toMatchObject({ applicationFeeArs: 495, debtOffsetArs: 345 });
    expect(await unreservedOf(CARRIER)).toBe(655);
  });

  it("emisor con deuda: paga precio + recargo y el fee lleva el recargo menos la comisión de MP", async () => {
    await owe(PAYER, 200);
    const res = await createHold();
    expect(res.json()).toMatchObject({ baseAmountArs: 1150, amountArs: 1350, applicationFeeArs: 340.02, debtSurchargeArs: 200 });

    const [, body] = mp.createPayment.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(body).toMatchObject({ transaction_amount: 1350, application_fee: 340.02 });
    const [entry] = await entriesOf(PAYER);
    expect(entry).toMatchObject({ type: "payment_surcharge", status: "reserved", roleAtOrigin: "sender" });
    expect(entry.amountArs.toNumber()).toBe(-200);
    // Un reintento de shipments con el precio (no el monto cobrado) devuelve el mismo hold.
    const replay = await createHold();
    expect(replay.statusCode).toBe(200);
    expect(mp.createPayment).toHaveBeenCalledTimes(1);
  });

  it("checkout-data muestra el recargo al emisor sin reservar nada", async () => {
    await owe(PAYER, 200);
    const res = await app.inject({
      method: "POST",
      url: `${HOLDS}/checkout-data`,
      payload: { shipmentId: SHIPMENT, carrierId: CARRIER, amountArs: 1150, payerEmail: "e@x.com", payerUserId: PAYER },
    });
    expect(res.json()).toMatchObject({ amountArs: 1350, baseAmountArs: 1150, debtSurchargeArs: 200 });
    expect(await entriesOf(PAYER)).toHaveLength(0);
  });

  it("hold liberado: la reserva se anula y la deuda vuelve a quedar pendiente", async () => {
    await owe(CARRIER, 100);
    await owe(PAYER, 200);
    await createHold();
    const release = await app.inject({ method: "POST", url: `${HOLDS}/by-shipment/${SHIPMENT}/release` });
    expect(release.json().status).toBe("cancelled");

    expect((await entriesOf(CARRIER)).map((e) => e.status)).toEqual(["voided"]);
    expect((await entriesOf(PAYER)).map((e) => e.status)).toEqual(["voided"]);
    expect(await balanceOf(CARRIER)).toBe(100);
    expect(await balanceOf(PAYER)).toBe(200);
  });

  it("hold rechazado por MP o vencido: la reserva también se anula", async () => {
    await owe(CARRIER, 100);
    mp.createPayment.mockResolvedValueOnce(payment({ id: 5, status: "rejected", status_detail: "cc_rejected_other_reason" }));
    expect((await createHold()).json().status).toBe("rejected");
    expect(await balanceOf(CARRIER)).toBe(100);

    // El reintento con otra tarjeta reserva de nuevo; si MP lo vence (webhook), vuelve a pendiente.
    const second = await createHold({ cardToken: "card-token-2" });
    expect(second.json()).toMatchObject({ status: "authorized", debtOffsetArs: 100 });
    expect(await unreservedOf(CARRIER)).toBe(0);
    await app.db.hold.update({ where: { id: second.json().id }, data: { status: "cancelled", statusDetail: "expired" } });
    expect(await balanceOf(CARRIER)).toBe(100);
  });

  it("dos holds en paralelo del mismo transportista no descuentan dos veces la misma deuda", async () => {
    await owe(CARRIER, 400);
    const [a, b] = await Promise.all([createHold(), createHold({ shipmentId: SHIPMENT_2, cardToken: "card-token-2" })]);
    const offsets = [a.json().debtOffsetArs, b.json().debtOffsetArs].sort((x, y) => x - y);
    expect(offsets).toEqual([55, 345]);
    expect(await unreservedOf(CARRIER)).toBe(0);
  });

  it("el mismo usuario con deuda, cobrador en un envío y pagador en otro, no la paga dos veces", async () => {
    await owe(CARRIER, 300);
    const asCarrier = await createHold();
    expect(asCarrier.json().debtOffsetArs).toBe(300);
    const asPayer = await createHold({ shipmentId: SHIPMENT_2, carrierId: OTHER_CARRIER, payerUserId: CARRIER });
    expect(asPayer.json()).toMatchObject({ amountArs: 1150, debtSurchargeArs: 0 });
    expect(await unreservedOf(CARRIER)).toBe(0);
  });

  it("el total que el emisor confirmó tiene que coincidir: si su deuda cambió, 409 y no se crea nada", async () => {
    await owe(PAYER, 200);
    // El emisor vio `precio + 200`; antes de pagar se le suma otra deuda (tope: 30% del precio = 345).
    await owe(PAYER, 100);

    const stale = await createHold({ expectedTotalArs: 1350 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: "HOLD_AMOUNT_CHANGED", details: { totalArs: 1450 } });
    expect(mp.createPayment).not.toHaveBeenCalled();
    expect(await app.db.hold.count()).toBe(0);
    expect(await entriesOf(PAYER)).toHaveLength(0);

    // Con el total nuevo sí se crea.
    const ok = await createHold({ expectedTotalArs: 1450 });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ amountArs: 1450, debtSurchargeArs: 300 });
  });

  it("un pago de saldo abierto descuenta de lo que cobra el hold, y un hold reservado limita el pago de saldo", async () => {
    await owe(PAYER, 200);
    const attempts = createBalancePaymentAttemptRepository(app.db);
    const data = (amountArs: number) => ({
      userId: PAYER,
      amountArs: new Prisma.Decimal(amountArs),
      savedCardId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      requestFingerprint: `fp-${amountArs}`,
    });

    // El pago de saldo abierto (150) ya tomó esa parte de la deuda: el hold solo puede cobrar 50.
    const open = await attempts.insertOpen(data(150));
    expect(open.created).toBe(true);
    const hold = await createHold();
    expect(hold.json()).toMatchObject({ debtSurchargeArs: 50, amountArs: 1200 });
    await attempts.updateOpen(open.attempt.id, { status: "rejected" });

    // Con 50 reservados por el hold, del saldo de 200 solo se pueden pagar 150.
    await expect(attempts.insertOpen(data(151))).rejects.toMatchObject({ code: "BALANCE_AMOUNT_EXCEEDS_DEBT" });
    expect((await attempts.insertOpen(data(150))).created).toBe(true);
  });

  it("un pago de saldo y un hold en paralelo no cobran la misma deuda dos veces", async () => {
    await owe(PAYER, 200);
    const attempts = createBalancePaymentAttemptRepository(app.db);
    const [pay, hold] = await Promise.allSettled([
      attempts.insertOpen({
        userId: PAYER,
        amountArs: new Prisma.Decimal(200),
        savedCardId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        requestFingerprint: "fp",
      }),
      createHold(),
    ]);
    const holdJson = hold.status === "fulfilled" ? hold.value.json() : null;
    const surcharge = holdJson?.debtSurchargeArs ?? 0;
    const paid = pay.status === "fulfilled" ? 200 : 0;
    // Lo que cobran los dos juntos nunca supera la deuda.
    expect(surcharge + paid).toBeLessThanOrEqual(200);
    expect(surcharge + paid).toBe(200);
  });

  it("al capturar, la deuda pasa a settled y la liquidación separa la comisión de la deuda cobrada", async () => {
    await owe(CARRIER, 100);
    await owe(PAYER, 200);
    const hold = (await createHold()).json();
    const captured = payment({
      id: hold.mpPaymentId ? Number(hold.mpPaymentId) : 1,
      status: "approved",
      status_detail: "accredited",
      transaction_amount: 1350,
      fee_details: [
        { type: "mercadopago_fee", amount: 67.37, fee_payer: "collector" },
        { type: "application_fee", amount: 440.02, fee_payer: "collector" },
      ],
      transaction_details: { net_received_amount: 842.61 },
    } as Partial<PaymentResponse>);
    mp.capturePayment.mockResolvedValueOnce(captured);
    mp.getPayment.mockResolvedValue(captured);

    const res = await app.inject({ method: "POST", url: `${HOLDS}/by-shipment/${SHIPMENT}/capture` });
    expect(res.statusCode).toBe(200);
    expect(res.json().settlement).toMatchObject({
      status: "credited",
      grossAmountArs: 1350,
      commissionArs: 150,
      debtOffsetArs: 100,
      debtSurchargeArs: 200,
    });
    expect((await entriesOf(CARRIER)).map((e) => e.status)).toEqual(["settled"]);
    expect((await entriesOf(PAYER)).map((e) => e.status)).toEqual(["settled"]);
    expect(await balanceOf(CARRIER)).toBe(0);
    expect(await balanceOf(PAYER)).toBe(0);

    // Una segunda captura no vuelve a tocar la cuenta corriente.
    await app.inject({ method: "POST", url: `${HOLDS}/by-shipment/${SHIPMENT}/capture` });
    expect(await entriesOf(CARRIER)).toHaveLength(1);
  });

  it("si el hold se canceló mientras MP capturaba, la deuda cobrada igual se asienta (una sola vez)", async () => {
    await owe(CARRIER, 100);
    const hold = (await createHold()).json();
    // El trigger anula la reserva al pasar a cancelled.
    await app.db.hold.update({ where: { id: hold.id }, data: { status: "cancelled" } });
    expect(await balanceOf(CARRIER)).toBe(100);

    const ledger = createUserLedgerRepository(app.db);
    const settled = [{ type: "fee_offset" as const, amountArs: new Prisma.Decimal(100) }];
    await ledger.settleHoldDebt(hold.id, settled);
    await ledger.settleHoldDebt(hold.id, settled);

    const entries = await entriesOf(CARRIER);
    expect(entries.map((e) => [e.status, e.amountArs.toNumber()])).toEqual([
      ["voided", -100],
      ["settled", -100],
    ]);
    expect(await balanceOf(CARRIER)).toBe(0);
  });

  it("dos asientos concurrentes con un monto retenido distinto no fallan ni duplican", async () => {
    await owe(CARRIER, 100);
    const hold = (await createHold()).json();
    const ledger = createUserLedgerRepository(app.db);
    const settled = [{ type: "fee_offset" as const, amountArs: new Prisma.Decimal(60) }];

    await Promise.all([ledger.settleHoldDebt(hold.id, settled), ledger.settleHoldDebt(hold.id, settled)]);

    const entries = await entriesOf(CARRIER);
    expect(entries.map((e) => [e.status, e.amountArs.toNumber()])).toEqual([
      ["voided", -100],
      ["settled", -60],
    ]);
    expect(await balanceOf(CARRIER)).toBe(40);
  });

  it("si cobrador y pagador fueran la misma persona, su deuda se cobra una sola vez", async () => {
    await owe(CARRIER, 100);
    const res = await createHold({ payerUserId: CARRIER });
    expect(res.json()).toMatchObject({ amountArs: 1150, debtOffsetArs: 100, debtSurchargeArs: 0 });
    expect(await unreservedOf(CARRIER)).toBe(0);
  });

  it("el historial del transportista no muestra el recargo del emisor y su desglose cierra con el neto", async () => {
    await owe(CARRIER, 100);
    await owe(PAYER, 200);
    const hold = (await createHold()).json();
    await app.db.hold.update({ where: { id: hold.id }, data: { payerId: PAYER } });
    const captured = payment({
      status: "approved",
      status_detail: "accredited",
      transaction_amount: 1350,
      fee_details: [
        { type: "mercadopago_fee", amount: 67.37, fee_payer: "collector" },
        { type: "application_fee", amount: 440.02, fee_payer: "collector" },
      ],
      transaction_details: { net_received_amount: 842.61 },
    } as Partial<PaymentResponse>);
    mp.capturePayment.mockResolvedValueOnce(captured);
    mp.getPayment.mockResolvedValue(captured);
    await app.inject({ method: "POST", url: `${HOLDS}/by-shipment/${SHIPMENT}/capture` });

    const asCarrier = await app.inject({
      method: "GET",
      url: `/payments/transactions/${hold.id}?role=carrier`,
      headers: { "x-user-id": CARRIER },
    });
    expect(asCarrier.statusCode, asCarrier.body).toBe(200);
    expect(asCarrier.json().amountArs).toBe(1150);
    const b = asCarrier.json().breakdown;
    expect(b).toEqual({ grossArs: 1150, mpFeeArs: 57.39, commissionArs: 150, debtOffsetArs: 100, netArs: 842.61 });
    expect(Math.round((b.grossArs - b.mpFeeArs - b.commissionArs - b.debtOffsetArs) * 100) / 100).toBe(b.netArs);

    const asSender = await app.inject({
      method: "GET",
      url: `/payments/transactions/${hold.id}?role=sender`,
      headers: { "x-user-id": PAYER },
    });
    expect(asSender.json().amountArs).toBe(1350);
  });

  it("vista previa del transportista: cuánto se descontaría en cada precio, sin reservar", async () => {
    await owe(CARRIER, 400);
    const res = await app.inject({
      method: "POST",
      url: `${USERS}/${CARRIER}/debt-collection/preview`,
      payload: { amountsArs: [1150, 500] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pendingBalanceArs: 400, debtOffsetsArs: [345, 150] });
    expect(await entriesOf(CARRIER)).toHaveLength(0);
  });
});
