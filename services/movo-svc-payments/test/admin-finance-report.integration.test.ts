import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { FinanceReport, FinanceReportRowsResponse, ReportSource } from "@movo/shared";
import { buildApp } from "../src/app";

// Mediodía de Argentina (UTC-3) del día pedido.
const noon = (day: string) => new Date(`${day}T15:00:00.000Z`);

const FROM = "2026-10-01";
const TO = "2026-10-02";

type SettlementStatus = "processing" | "credited" | "failed" | "escalated";

/** MOVO-35 B7-B9: el reporte financiero contra Postgres real, con liquidaciones sin confirmar por MP. */
describe("reporte de Finanzas (Postgres) — MOVO-35", () => {
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

  async function settlement(options: { status: SettlementStatus; createdAt: Date; capturedAt?: Date; kind?: "delivery" | "cancellation_penalty"; gross?: number; surcharge?: number }) {
    const shipmentId = randomUUID();
    const hold = await app.db.hold.create({
      data: {
        shipmentId,
        attempt: 1,
        carrierId: randomUUID(),
        collectorId: "collector",
        amountArs: options.gross ?? 1150,
        applicationFeeArs: 150,
        baseAmountArs: 1000,
        commissionArs: 150,
        status: "captured",
        wasAuthorized: true,
      },
    });
    const confirmed = options.status === "credited";
    return app.db.settlement.create({
      data: {
        shipmentId,
        holdId: hold.id,
        carrierId: hold.carrierId,
        mpPaymentId: `mp-${randomUUID()}`,
        grossAmountArs: options.gross ?? 1150,
        debtSurchargeArs: options.surcharge ?? 150,
        commissionArs: 150,
        // Hasta que MP confirma la captura, el fee y el neto son null (MOVO-212).
        ...(confirmed ? { mpFeeArs: 50, netAmountArs: 800, capturedAt: options.capturedAt ?? options.createdAt } : {}),
        status: options.status,
        kind: options.kind ?? "delivery",
        createdAt: options.createdAt,
      },
    });
  }

  async function ledger(userId: string, amountArs: number, createdAt: Date, status: "pending" | "reserved" | "settled" | "voided" = "pending") {
    return app.db.userLedgerEntry.create({
      data: {
        userId,
        type: amountArs > 0 ? "cash_commission" : "voluntary_payment",
        amountArs,
        status,
        idempotencyKey: randomUUID(),
        requestFingerprint: "x",
        createdAt,
      },
    });
  }

  async function get(): Promise<ReportSource<FinanceReport>> {
    const response = await app.inject({ method: "GET", url: `/internal/payments/admin/reports/finance?from=${FROM}&to=${TO}` });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it("suma solo lo que MP confirmó y cuenta aparte lo pendiente y lo escalado", async () => {
    await settlement({ status: "credited", createdAt: noon("2026-10-01") });
    await settlement({ status: "credited", createdAt: noon("2026-09-30") });
    await settlement({ status: "processing", createdAt: noon("2026-10-02") });
    await settlement({ status: "escalated", createdAt: noon("2026-10-02"), gross: 2000 });
    await settlement({ status: "failed", createdAt: noon("2026-10-02") });

    const report = await get();

    expect(report.kpis.collected).toEqual({ value: 1150, previous: 1150 });
    expect(report.kpis.shipmentPrice.value).toBe(1000);
    expect(report.kpis.commission.value).toBe(150);
    expect(report.kpis.mpFee.value).toBe(50);
    expect(report.kpis.carrierNet.value).toBe(800);
    expect(report.pendingConfirmation).toEqual({ count: 1, amountArs: 1150 });
    expect(report.escalated).toEqual({ count: 1, amountArs: 2000 });
    expect(report.series.collected.map((point) => point.value)).toEqual([1150, 0]);
  });

  it("desglosa lo cobrado por tipo de captura y suma los reembolsos terminados", async () => {
    const delivered = await settlement({ status: "credited", createdAt: noon("2026-10-01") });
    await settlement({ status: "credited", createdAt: noon("2026-10-01"), kind: "cancellation_penalty", gross: 300, surcharge: 0 });
    const refund = (amountArs: number, status: "succeeded" | "fallback_to_ledger" | "failed", attempt: number) =>
      app.db.refund.create({
        data: {
          settlementId: delivered.id,
          shipmentId: delivered.shipmentId,
          holdId: delivered.holdId,
          carrierId: delivered.carrierId,
          mpPaymentId: delivered.mpPaymentId,
          attempt,
          amountArs,
          reason: "disputa",
          requestKey: randomUUID(),
          requestFingerprint: "x",
          adminId: randomUUID(),
          mpIdempotencyKey: randomUUID(),
          status,
          completedAt: noon("2026-10-02"),
        },
      });
    await refund(200, "succeeded", 1);
    await refund(100, "fallback_to_ledger", 2);
    await refund(999, "failed", 3);

    const report = await get();
    const kinds = report.breakdowns.find((row) => row.dimension === "kind")?.rows ?? [];
    const refunds = report.breakdowns.find((row) => row.dimension === "refundStatus")?.rows ?? [];

    expect(kinds.map((row) => [row.key, row.value])).toEqual([
      ["delivery", 1150],
      ["cancellation_penalty", 300],
      ["dispute_partial", 0],
    ]);
    expect(report.kpis.refunded.value).toBe(300);
    expect(refunds.map((row) => [row.key, row.value])).toEqual([
      ["succeeded", 200],
      ["fallback_to_ledger", 100],
    ]);

    const rows = await app.inject({ method: "GET", url: `/internal/payments/admin/reports/finance/rows?from=${FROM}&to=${TO}&limit=1` });
    const body: FinanceReportRowsResponse = rows.json();
    expect(body.truncated).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(Object.keys(body.items[0] ?? {})).not.toContain("carrierId");
  });

  it("lee la deuda abierta al cierre de cada período, como el saldo de la cuenta corriente", async () => {
    const debtor = randomUUID();
    const creditor = randomUUID();
    await ledger(debtor, 500, noon("2026-09-29"));
    await ledger(debtor, -200, noon("2026-10-01"), "settled");
    // Una reserva negativa de un hold en curso todavía no cobró nada, y lo anulado no cuenta.
    await ledger(debtor, -300, noon("2026-10-01"), "reserved");
    await ledger(debtor, 1000, noon("2026-10-01"), "voided");
    await ledger(creditor, -150, noon("2026-10-02"), "settled");

    const report = await get();

    expect(report.kpis.openDebt).toEqual({ value: 300, previous: 500 });
    expect(report.kpis.debtGenerated.value).toBe(0);
    expect(report.kpis.debtCollected.value).toBe(350);
    expect(report.series.openDebt.map((point) => point.value)).toEqual([300, 300]);
    expect(report.debt).toEqual({ debtorUsers: 1, creditUsers: 1, creditArs: 150 });
  });
});
