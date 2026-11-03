import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { FastifyInstance } from "fastify";
import { cashPenaltyCompensationArs, decomposeOfferGrossPrice } from "@movo/shared";
import { buildApp } from "../src/app";

// MOVO-37: integración contra Postgres real (convención del repo): la idempotencia y la atomicidad las da la base
// (lock por envío + unicidad de `shipment_id` y de la idempotencyKey), no se pueden mockear.

const SENDER = "11111111-1111-4111-8111-111111111111";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("envíos en efectivo (MOVO-37)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.cash_shipment_payments, payments.user_ledger_entries CASCADE");
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.cash_shipment_payments, payments.user_ledger_entries CASCADE");
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE payments.settlements, payments.payment_provider_events, payments.holds, payments.balance_payment_attempts, payments.saved_cards CASCADE"
    );
  });

  const registerCommission = (body: Record<string, unknown> = {}, shipmentId = SHIPMENT) =>
    app.inject({
      method: "POST",
      url: `/internal/payments/cash-shipments/${shipmentId}/commission`,
      payload: { senderId: SENDER, carrierId: CARRIER, agreedPriceArs: 11500, ...body },
    });

  const registerPenalty = (body: Record<string, unknown> = {}, shipmentId = SHIPMENT) =>
    app.inject({
      method: "POST",
      url: `/internal/payments/cash-shipments/${shipmentId}/cancellation-penalty`,
      payload: { senderId: SENDER, carrierId: CARRIER, agreedPriceArs: 10000, penaltyArs: 2500, ...body },
    });

  const balanceOf = async (userId: string) =>
    (await app.inject({ method: "GET", url: `/internal/payments/users/${userId}/balance` })).json() as {
      balanceArs: number;
      oldestUnpaidAt: string | null;
    };

  describe("comisión al entregar (P1, P2)", () => {
    it("registra la comisión como deuda del transportista, con el mismo cálculo que el application_fee", async () => {
      const res = await registerCommission();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      const expected = decomposeOfferGrossPrice(11500).commissionAmountArs;
      expect(body.commissionArs).toBe(expected);
      expect(body.entry).toMatchObject({
        userId: CARRIER,
        type: "cash_commission",
        roleAtOrigin: "carrier",
        amountArs: expected,
        status: "pending",
        shipmentId: SHIPMENT,
      });
      expect((await balanceOf(CARRIER)).balanceArs).toBe(expected);
      expect((await balanceOf(SENDER)).balanceArs).toBe(0);
    });

    it("es idempotente por envío: un reintento devuelve lo registrado sin duplicar la deuda", async () => {
      const first = (await registerCommission()).json();
      const again = await registerCommission();

      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ ...first, created: false });
      expect((await balanceOf(CARRIER)).balanceArs).toBe(first.commissionArs);
      expect(await app.db.cashShipmentPayment.count()).toBe(1);
    });

    it("dos registros a la vez del mismo envío terminan en una sola deuda", async () => {
      const results = await Promise.all([registerCommission(), registerCommission(), registerCommission()]);

      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
      expect(await app.db.userLedgerEntry.count({ where: { type: "cash_commission" } })).toBe(1);
    });

    it("un reintento con otro precio o con otro transportista es un conflicto", async () => {
      await registerCommission();

      expect((await registerCommission({ agreedPriceArs: 12000 })).json().error.code).toBe("LEDGER_IDEMPOTENCY_CONFLICT");
      expect((await registerCommission({ carrierId: OTHER })).statusCode).toBe(409);
    });

    it("valida el cuerpo", async () => {
      expect((await registerCommission({ agreedPriceArs: 0 })).statusCode).toBe(400);
      expect((await registerCommission({ agreedPriceArs: 100.123 })).statusCode).toBe(400);
      expect((await registerCommission({ carrierId: "no-uuid" })).statusCode).toBe(400);
    });
  });

  describe("penalidad del emisor sin hold (P3)", () => {
    it("registra la penalidad como deuda del emisor y acredita la compensación al transportista", async () => {
      const res = await registerPenalty();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      const compensation = cashPenaltyCompensationArs(10000, 2500);
      expect(compensation).toBeGreaterThan(0);
      expect(body.compensationArs).toBe(compensation);
      expect(body.penaltyEntry).toMatchObject({ userId: SENDER, type: "cancellation_penalty", amountArs: 2500, status: "pending" });
      expect(body.compensationEntry).toMatchObject({
        userId: CARRIER,
        type: "cancellation_compensation",
        amountArs: -compensation,
        status: "settled",
      });
      expect((await balanceOf(SENDER)).balanceArs).toBe(2500);
      expect(await balanceOf(CARRIER)).toEqual({ balanceArs: -compensation, oldestUnpaidAt: null });
    });

    it("la compensación es la de la captura parcial con tarjeta: penalidad − comisión del precio − fee de MP", () => {
      const commission = decomposeOfferGrossPrice(10000).commissionAmountArs;
      expect(cashPenaltyCompensationArs(10000, 2500, { mpRate: 0.05 })).toBe(Math.round((2500 - commission - 125) * 100) / 100);
    });

    it("sin compensación cuando la penalidad no cubre la comisión", async () => {
      const body = (await registerPenalty({ penaltyArs: 500 })).json();

      expect(body.compensationArs).toBe(0);
      expect(body.compensationEntry).toBeNull();
      expect((await balanceOf(CARRIER)).balanceArs).toBe(0);
    });

    it("es idempotente por envío", async () => {
      const first = (await registerPenalty()).json();
      const again = await registerPenalty();

      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ ...first, created: false });
      expect((await balanceOf(SENDER)).balanceArs).toBe(2500);
      expect((await balanceOf(CARRIER)).balanceArs).toBe(-first.compensationArs);
    });

    it("un reintento con otro monto es un conflicto y no registra nada más", async () => {
      await registerPenalty();

      expect((await registerPenalty({ penaltyArs: 3000 })).statusCode).toBe(409);
      expect((await balanceOf(SENDER)).balanceArs).toBe(2500);
    });

    it("rechaza una penalidad mayor que el precio", async () => {
      expect((await registerPenalty({ penaltyArs: 20000 })).statusCode).toBe(400);
    });
  });

  describe("historial (P5)", () => {
    const list = (role: string, userId: string) =>
      app.inject({ method: "GET", url: `/payments/transactions?role=${role}`, headers: { "x-user-id": userId } });

    it("el envío entregado aparece como cobro en efectivo para las dos partes, sin tarjeta", async () => {
      await registerCommission();
      const commission = decomposeOfferGrossPrice(11500).commissionAmountArs;

      const sender = (await list("sender", SENDER)).json().items;
      expect(sender).toHaveLength(1);
      expect(sender[0]).toMatchObject({
        kind: "cash_shipment",
        shipmentId: SHIPMENT,
        amountArs: 11500,
        status: "completed",
        card: null,
        debtAmountArs: null,
      });

      const carrier = (await list("carrier", CARRIER)).json().items;
      expect(carrier).toHaveLength(1);
      expect(carrier[0]).toMatchObject({ kind: "cash_shipment", amountArs: 11500, status: "completed" });
      expect(carrier[0]).not.toHaveProperty("card");

      const detail = (
        await app.inject({
          method: "GET",
          url: `/payments/transactions/${carrier[0].id}?role=carrier`,
          headers: { "x-user-id": CARRIER },
        })
      ).json();
      expect(detail.movements).toEqual([]);
      expect(detail.breakdown).toEqual({
        grossArs: 11500,
        mpFeeArs: 0,
        commissionArs: commission,
        debtOffsetArs: 0,
        netArs: Math.round((11500 - commission) * 100) / 100,
      });
    });

    it("filtra por estado como el resto: un efectivo es completed", async () => {
      await registerCommission();

      expect((await app.inject({
        method: "GET",
        url: "/payments/transactions?role=sender&status=reserved",
        headers: { "x-user-id": SENDER },
      })).json().items).toHaveLength(0);
      expect((await app.inject({
        method: "GET",
        url: "/payments/transactions?role=sender&status=completed",
        headers: { "x-user-id": SENDER },
      })).json().items).toHaveLength(1);
    });

    it("no aparece en el historial de otro usuario", async () => {
      await registerCommission();

      expect((await list("sender", OTHER)).json().items).toHaveLength(0);
      expect((await list("carrier", SENDER)).json().items).toHaveLength(0);
    });
  });
});
