import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { PAYMENT_REPORT_FACTS_MAX_IDS, PaymentReportFactsResponse } from "@movo/shared";
import { buildApp } from "../src/app";

/** MOVO-35: el cobro de cada envío, para Cashflow y Precio y volumen, contra Postgres real. */
describe("datos de cobro para los reportes (Postgres) — MOVO-35", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE payments.refunds, payments.settlements, payments.payment_provider_events, payments.holds, payments.cash_shipment_payments, payments.user_ledger_entries CASCADE",
    );
  });

  async function hold(shipmentId: string, data: { status?: "authorized" | "captured" | "cancelled" | "rejected"; attempt?: number; wasAuthorized?: boolean; statusDetail?: string; commissionArs?: number } = {}) {
    return app.db.hold.create({
      data: {
        shipmentId,
        attempt: data.attempt ?? 1,
        carrierId: randomUUID(),
        collectorId: "collector",
        amountArs: 1150,
        applicationFeeArs: 150,
        baseAmountArs: 1000,
        commissionArs: data.commissionArs ?? 150,
        status: data.status ?? "captured",
        wasAuthorized: data.wasAuthorized ?? false,
        ...(data.statusDetail ? { statusDetail: data.statusDetail } : {}),
      },
    });
  }

  async function settlement(shipmentId: string, kind: "delivery" | "cancellation_penalty" | "dispute_partial" = "delivery") {
    const row = await hold(shipmentId);
    return app.db.settlement.create({
      data: {
        shipmentId,
        holdId: row.id,
        carrierId: row.carrierId,
        mpPaymentId: `mp-${randomUUID()}`,
        grossAmountArs: 1150,
        debtSurchargeArs: 150,
        commissionArs: 150,
        status: "credited",
        kind,
      },
    });
  }

  async function facts(shipmentIds: string[]): Promise<PaymentReportFactsResponse["items"]> {
    const response = await app.inject({ method: "POST", url: "/internal/payments/admin/report-facts", payload: { shipmentIds } });
    expect(response.statusCode).toBe(200);
    return response.json().items;
  }

  it("sin envíos pedidos o sin movimientos, no devuelve filas", async () => {
    expect(await facts([])).toEqual([]);
    expect(await facts([randomUUID()])).toEqual([]);
  });

  it("una liquidación trae lo capturado sin el recargo por deuda, y los reembolsos que salieron", async () => {
    const shipmentId = randomUUID();
    const settled = await settlement(shipmentId);
    const refund = (amountArs: number, status: "succeeded" | "failed", attempt: number) =>
      app.db.refund.create({
        data: {
          settlementId: settled.id,
          shipmentId,
          holdId: settled.holdId,
          carrierId: settled.carrierId,
          mpPaymentId: settled.mpPaymentId,
          attempt,
          amountArs,
          reason: "disputa",
          requestKey: randomUUID(),
          requestFingerprint: "x",
          adminId: randomUUID(),
          mpIdempotencyKey: randomUUID(),
          status,
        },
      });
    await refund(200, "succeeded", 1);
    await refund(999, "failed", 2);

    const [fact] = await facts([shipmentId]);

    expect(fact).toMatchObject({ shipmentId, settlementStatus: "credited", capturedArs: 1000, commissionArs: 150, refundedArs: 200 });
  });

  it("una penalidad por cancelación no es el cobro del envío", async () => {
    const shipmentId = randomUUID();
    await settlement(shipmentId, "cancellation_penalty");

    const [fact] = await facts([shipmentId]);

    expect(fact).toMatchObject({ settlementStatus: null, capturedArs: null, commissionArs: null, holdCommissionArs: 150 });
  });

  it("distingue un hold rechazado de uno vencido, y un cancelado por nosotros no es ninguno de los dos", async () => {
    const rejected = randomUUID();
    const expired = randomUUID();
    const released = randomUUID();
    await hold(rejected, { status: "rejected" });
    await hold(expired, { status: "cancelled", wasAuthorized: true, statusDetail: "expired" });
    await hold(released, { status: "cancelled", wasAuthorized: true, statusDetail: "by_collector" });

    const items = await facts([rejected, expired, released]);
    const of = (id: string) => items.find((item) => item.shipmentId === id);

    expect(of(rejected)).toMatchObject({ holdRejected: true, holdExpired: false });
    expect(of(expired)).toMatchObject({ holdRejected: false, holdExpired: true });
    expect(of(released)).toMatchObject({ holdRejected: false, holdExpired: false });
  });

  it("toma la comisión del hold más reciente", async () => {
    const shipmentId = randomUUID();
    await hold(shipmentId, { attempt: 1, status: "cancelled", commissionArs: 100 });
    await hold(shipmentId, { attempt: 2, status: "authorized", commissionArs: 170 });

    expect((await facts([shipmentId]))[0]?.holdCommissionArs).toBe(170);
  });

  it("en efectivo trae la comisión y si sigue como deuda", async () => {
    const payment = async (status: "pending" | "settled" | null) => {
      const shipmentId = randomUUID();
      const userId = randomUUID();
      const entry = status
        ? await app.db.userLedgerEntry.create({
            data: { userId, type: "cash_commission", amountArs: -150, status, shipmentId, idempotencyKey: randomUUID(), requestFingerprint: "x" },
          })
        : null;
      await app.db.cashShipmentPayment.create({
        data: { shipmentId, senderId: randomUUID(), carrierId: userId, amountArs: 1000, commissionArs: 150, ledgerEntryId: entry?.id ?? null },
      });
      return shipmentId;
    };
    const open = await payment("pending");
    const paid = await payment("settled");

    const items = await facts([open, paid]);

    expect(items.find((item) => item.shipmentId === open)).toMatchObject({ cashCommissionArs: 150, cashCommissionDebtOpen: true });
    expect(items.find((item) => item.shipmentId === paid)).toMatchObject({ cashCommissionArs: 150, cashCommissionDebtOpen: false });
  });

  it("más ids que el tope por pedido es 400", async () => {
    const shipmentIds = Array.from({ length: PAYMENT_REPORT_FACTS_MAX_IDS + 1 }, () => randomUUID());
    const response = await app.inject({ method: "POST", url: "/internal/payments/admin/report-facts", payload: { shipmentIds } });
    expect(response.statusCode).toBe(400);
  });

  it("un id inválido es 400", async () => {
    const response = await app.inject({ method: "POST", url: "/internal/payments/admin/report-facts", payload: { shipmentIds: ["nope"] } });
    expect(response.statusCode).toBe(400);
  });
});
