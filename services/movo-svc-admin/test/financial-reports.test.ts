import { describe, expect, it } from "vitest";
import { PaymentReportFact, QuoteBreakdown, ShipmentReportFact } from "@movo/shared";
import { captureLeakage, cashflowReport, classifyLeakage, gmvBridge, PaymentFactsById, pricingReport } from "../src/modules/reports/financial-reports";

const RANGE = { from: "2026-10-01", to: "2026-10-02" };
const NOW = new Date("2026-10-03T12:00:00.000Z");
const IN_RANGE = "2026-10-01T15:00:00.000Z";
const LATER_IN_RANGE = "2026-10-02T15:00:00.000Z";
const BEFORE = "2026-09-29T15:00:00.000Z";

let nextId = 0;
function fact(overrides: Partial<ShipmentReportFact> = {}): ShipmentReportFact {
  nextId += 1;
  return {
    shipmentId: `s-${nextId}`,
    status: "completed",
    paymentMethod: "card",
    band: "50_200",
    suggestedPriceArs: 1000,
    agreedPriceArs: 1000,
    calculationMethod: "package_tapered_v3",
    breakdown: null,
    publishedAt: IN_RANGE,
    firstAssignedAt: IN_RANGE,
    firstCompletedAt: IN_RANGE,
    deliveredAt: IN_RANGE,
    cancelledBySystem: false,
    ...overrides,
  };
}

function payment(shipmentId: string, overrides: Partial<PaymentReportFact> = {}): PaymentReportFact {
  return {
    shipmentId,
    settlementStatus: null,
    capturedArs: null,
    commissionArs: null,
    holdCommissionArs: null,
    refundedArs: 0,
    holdRejected: false,
    holdExpired: false,
    cashCommissionArs: null,
    cashCommissionDebtOpen: false,
    ...overrides,
  };
}

const byId = (rows: PaymentReportFact[]): PaymentFactsById => new Map(rows.map((row) => [row.shipmentId, row]));

function breakdown(overrides: Partial<QuoteBreakdown> = {}): QuoteBreakdown {
  return {
    distanceKm: 100,
    distanceSource: "routes_api",
    fuelArsPerLiter: 1000,
    fuelSource: "api",
    perKmArs: 100,
    base: 200,
    distance: 700,
    weight: 100,
    packageFactor: 1,
    demandRatio: 0,
    demandMultiplier: 1,
    ...overrides,
  };
}

describe("Cashflow — MOVO-35", () => {
  it("GMV y completados incluyen efectivo, con la comisión devengada, y avgTicket es gmv / completed", () => {
    const card = fact({ agreedPriceArs: 1000 });
    const cash = fact({ agreedPriceArs: 3000, paymentMethod: "cash", band: "200_500", firstCompletedAt: LATER_IN_RANGE });
    const report = cashflowReport(
      [card, cash],
      byId([payment(card.shipmentId, { settlementStatus: "credited", commissionArs: 150 }), payment(cash.shipmentId, { cashCommissionArs: 450, cashCommissionDebtOpen: true })]),
      RANGE,
      NOW,
    );

    expect(report.kpis.gmv.value).toBe(4000);
    expect(report.kpis.completed.value).toBe(2);
    expect(report.kpis.avgTicket.value).toBe(2000);
    expect(report.kpis.commission.value).toBe(600);
    expect(report.kpis.takeRate.value).toBe(15);
    expect(report.series.gmv.map((point) => point.value)).toEqual([1000, 3000]);
    const rows = report.breakdowns[0]?.rows ?? [];
    expect(rows.find((row) => row.key === "200_500")).toMatchObject({ value: 3000, share: 75, extra: { avgTicket: 3000 } });
    expect(rows.find((row) => row.key === "500_plus")).toMatchObject({ value: 0, share: 0, extra: { avgTicket: null } });
  });

  it("takeRate no baja por un completado sin comisión acreditada, y su comisión esperada no cuenta", () => {
    const credited = fact({ agreedPriceArs: 1000 });
    const noSettlement = fact({ agreedPriceArs: 1000 });
    const failed = fact({ agreedPriceArs: 1000 });
    const report = cashflowReport(
      [credited, noSettlement, failed],
      byId([payment(credited.shipmentId, { settlementStatus: "credited", commissionArs: 150 }), payment(failed.shipmentId, { settlementStatus: "failed", commissionArs: 150 })]),
      RANGE,
      NOW,
    );

    expect(report.kpis.gmv.value).toBe(3000);
    expect(report.kpis.commission.value).toBe(150);
    expect(report.kpis.takeRate.value).toBe(15);
  });

  it("una captura sin confirmar va aparte y no entra en el GMV", () => {
    const delivered = fact({ status: "delivered", firstCompletedAt: null, agreedPriceArs: 800 });
    const report = cashflowReport([delivered], byId([payment(delivered.shipmentId, { settlementStatus: "processing", capturedArs: 800 })]), RANGE, NOW);

    expect(report.kpis.gmv.value).toBe(0);
    expect(report.kpis.takeRate.value).toBeNull();
    expect(report.pendingCapture).toEqual({ count: 1, amountArs: 800 });
  });

  it("compara contra el período anterior", () => {
    const report = cashflowReport([fact({ agreedPriceArs: 1000 }), fact({ agreedPriceArs: 500, firstCompletedAt: BEFORE })], byId([]), RANGE, NOW);
    expect(report.kpis.gmv).toEqual({ value: 1000, previous: 500 });
    expect(report.breakdowns[0]?.total).toEqual({ value: 1000, previous: 500 });
  });
});

describe("Cascada de captura — MOVO-35", () => {
  const classify = (overrides: Partial<ShipmentReportFact>, pay: Partial<PaymentReportFact> = {}) => {
    const row = fact(overrides);
    return classifyLeakage(row, payment(row.shipmentId, pay), 100_000, 15_000)?.key ?? null;
  };

  it.each([
    ["sigue publicado", { status: "published" }, {}, "in_flight"],
    ["en viaje", { status: "in_transit" }, {}, "in_flight"],
    ["con una disputa abierta", { status: "disputed" }, {}, "in_flight"],
    ["entregado, captura en curso", { status: "delivered" }, { settlementStatus: "processing" }, "pending_capture"],
    ["entregado, captura fallida", { status: "delivered" }, { settlementStatus: "failed" }, "capture_failed"],
    ["entregado, captura escalada", { status: "delivered" }, { settlementStatus: "escalated" }, "capture_failed"],
    ["cancelado con reembolso", { status: "cancelled" }, { refundedArs: 1000 }, "dispute_refund"],
    ["cancelado, hold vencido", { status: "cancelled" }, { holdExpired: true }, "hold_expired"],
    ["cancelado, pago rechazado", { status: "cancelled" }, { holdRejected: true }, "payment_failed"],
    ["cancelado ya asignado", { status: "cancelled" }, {}, "cancelled"],
    ["cancelado por el emisor sin asignar", { status: "cancelled", firstAssignedAt: null }, {}, "cancelled"],
    ["venció sin transportista", { status: "cancelled", firstAssignedAt: null, cancelledBySystem: true }, {}, "unassigned"],
    ["completado entero", { status: "completed" }, { capturedArs: 1000 }, null],
    ["completado con reembolso parcial", { status: "completed" }, { capturedArs: 1000, refundedArs: 200 }, "dispute_refund"],
    ["completado con captura parcial", { status: "completed" }, { capturedArs: 700 }, "dispute_refund"],
    ["efectivo con la comisión pagada", { status: "completed" }, { cashCommissionArs: 150 }, null],
    ["efectivo con la comisión en deuda", { status: "completed" }, { cashCommissionArs: 150, cashCommissionDebtOpen: true }, "cash_commission_debt"],
  ] as Array<[string, Partial<ShipmentReportFact>, Partial<PaymentReportFact>, string | null]>)("%s", (_name, overrides, pay, expected) => {
    expect(classify(overrides, pay)).toBe(expected);
  });

  it("cierra exacto en GMV y en comisión, con montos que no redondean parejo", () => {
    const rows = [
      fact({ agreedPriceArs: 1000.1 }),
      fact({ status: "cancelled", agreedPriceArs: 333.33 }),
      fact({ status: "delivered", agreedPriceArs: 777.77 }),
      fact({ status: "completed", agreedPriceArs: 999.99 }),
      fact({ status: "completed", agreedPriceArs: 123.45, paymentMethod: "cash" }),
      fact({ status: "published", agreedPriceArs: null, suggestedPriceArs: 500.55 }),
    ];
    const payments = byId([
      payment(rows[3]?.shipmentId as string, { capturedArs: 999.99, refundedArs: 111.11, commissionArs: 150 }),
      payment(rows[4]?.shipmentId as string, { cashCommissionArs: 18.52, cashCommissionDebtOpen: true }),
    ]);

    const totals = captureLeakage(rows, payments, RANGE);
    const leakage = totals?.leakage;
    if (!leakage) throw new Error("falta la cascada");

    const cents = (value: number) => Math.round(value * 100);
    const lost = (pick: "gmvArs" | "commissionArs") => leakage.steps.reduce((total, step) => total + cents(step[pick]), 0);
    expect(cents(leakage.quoted.gmvArs) - lost("gmvArs")).toBe(cents(leakage.captured.gmvArs));
    expect(cents(leakage.quoted.commissionArs) - lost("commissionArs")).toBe(cents(leakage.captured.commissionArs));
    expect(leakage.steps.find((step) => step.key === "cash_commission_debt")).toMatchObject({ gmvArs: 0, commissionArs: 18.52 });
    expect(leakage.steps.find((step) => step.key === "in_flight")?.timing).toBe(true);
    expect(leakage.steps.find((step) => step.key === "cancelled")?.timing).toBe(false);
    expect(leakage.quoted.shipments).toBe(6);
  });

  it("va por fecha de publicación, y sin envíos publicados es null", () => {
    expect(captureLeakage([fact({ publishedAt: BEFORE })], byId([]), RANGE)).toBeNull();
  });
});

describe("Puente del GMV — MOVO-35", () => {
  const closes = (bridge: NonNullable<ReturnType<typeof gmvBridge>>) => {
    const cents = (value: number) => Math.round(value * 100);
    const total = cents(bridge.previous) + cents(bridge.volume) + cents(bridge.mix) + bridge.price.reduce((sum, row) => sum + cents(row.amount), 0);
    expect(total).toBe(cents(bridge.current));
  };
  const amount = (bridge: NonNullable<ReturnType<typeof gmvBridge>>, key: string) => bridge.price.find((row) => row.key === key)?.amount;

  it("sin completados en alguno de los dos períodos es null", () => {
    expect(gmvBridge([fact()], RANGE)).toBeNull();
    expect(gmvBridge([fact({ firstCompletedAt: BEFORE })], RANGE)).toBeNull();
  });

  it("separa volumen y mix: más envíos al mismo ticket no es precio", () => {
    const bridge = gmvBridge(
      [
        fact({ firstCompletedAt: BEFORE, agreedPriceArs: 1000 }),
        fact({ firstCompletedAt: BEFORE, agreedPriceArs: 3000, band: "500_plus" }),
        fact({ agreedPriceArs: 1000 }),
        fact({ agreedPriceArs: 1000 }),
        fact({ agreedPriceArs: 1000 }),
        fact({ agreedPriceArs: 3000, band: "500_plus" }),
      ],
      RANGE,
    );
    if (!bridge) throw new Error("falta el puente");

    expect(bridge).toMatchObject({ previous: 4000, current: 6000, volume: 4000, mix: -2000 });
    expect(bridge.price.every((row) => row.amount === 0)).toBe(true);
    closes(bridge);
  });

  it("abre el precio por componente con el desglose guardado", () => {
    const before = breakdown();
    const fuelUp = breakdown({ fuelArsPerLiter: 1100, base: 220, distance: 770, weight: 110 });
    const bridge = gmvBridge([fact({ firstCompletedAt: BEFORE, agreedPriceArs: 1000, suggestedPriceArs: 1000, breakdown: before }), fact({ agreedPriceArs: 1100, suggestedPriceArs: 1100, breakdown: fuelUp })], RANGE);
    if (!bridge) throw new Error("falta el puente");

    expect(amount(bridge, "fuel")).toBeCloseTo(100, 2);
    expect(amount(bridge, "demand")).toBeCloseTo(0, 2);
    expect(amount(bridge, "distance")).toBeCloseTo(0, 2);
    expect(amount(bridge, "other")).toBeCloseTo(0, 2);
    closes(bridge);
  });

  it("atribuye demanda, distancia, paquete y negociación", () => {
    const before = breakdown();
    const after = breakdown({ distance: 1400, base: 400, demandMultiplier: 1.2 });
    const bridge = gmvBridge(
      [fact({ firstCompletedAt: BEFORE, agreedPriceArs: 1000, suggestedPriceArs: 1000, breakdown: before }), fact({ agreedPriceArs: 2500, suggestedPriceArs: 2400, breakdown: after })],
      RANGE,
    );
    if (!bridge) throw new Error("falta el puente");

    // De 1000 a 2500. El modelo da 1900 sin recargo y 2280 con él; lo que el sugerido suma sobre el modelo va a other.
    expect(amount(bridge, "demand")).toBeCloseTo(380, 2);
    expect(amount(bridge, "distance")).toBeCloseTo(700, 2);
    expect(amount(bridge, "package")).toBeCloseTo(200, 2);
    expect(amount(bridge, "negotiation")).toBeCloseTo(100, 2);
    expect(amount(bridge, "other")).toBeCloseTo(120, 2);
    closes(bridge);
  });

  it("sin desglose guardado, el efecto precio cae en other", () => {
    const bridge = gmvBridge([fact({ firstCompletedAt: BEFORE, agreedPriceArs: 1000, suggestedPriceArs: null }), fact({ agreedPriceArs: 1300, suggestedPriceArs: null })], RANGE);
    if (!bridge) throw new Error("falta el puente");

    expect(amount(bridge, "other")).toBe(300);
    closes(bridge);
  });

  it("si cambió la versión dominante del tramo, lo no explicado va a algorithm", () => {
    const bridge = gmvBridge(
      [fact({ firstCompletedAt: BEFORE, agreedPriceArs: 1000, suggestedPriceArs: null, calculationMethod: "v2" }), fact({ agreedPriceArs: 1300, suggestedPriceArs: null, calculationMethod: "v3" })],
      RANGE,
    );
    if (!bridge) throw new Error("falta el puente");

    expect(amount(bridge, "algorithm")).toBe(300);
    closes(bridge);
  });

  it("cierra con montos que no redondean parejo y tramos que aparecen de un período a otro", () => {
    const bridge = gmvBridge(
      [
        fact({ firstCompletedAt: BEFORE, agreedPriceArs: 333.33, breakdown: breakdown() }),
        fact({ firstCompletedAt: BEFORE, agreedPriceArs: 777.77, band: "200_500" }),
        fact({ firstCompletedAt: BEFORE, agreedPriceArs: 100.01, band: null }),
        fact({ agreedPriceArs: 123.45, breakdown: breakdown({ fuelArsPerLiter: 1234.56, demandMultiplier: 1.37 }) }),
        fact({ agreedPriceArs: 999.99, band: "500_plus" }),
        fact({ agreedPriceArs: 555.55, band: "500_plus" }),
        fact({ agreedPriceArs: 111.11, band: null }),
      ],
      RANGE,
    );
    if (!bridge) throw new Error("falta el puente");
    closes(bridge);
  });
});

describe("Precio y volumen — MOVO-35", () => {
  it("el índice no se mueve si solo cambia el mix de distancias", () => {
    const report = pricingReport(
      [
        fact({ firstCompletedAt: BEFORE, agreedPriceArs: 1000 }),
        fact({ firstCompletedAt: BEFORE, agreedPriceArs: 3000, band: "500_plus" }),
        fact({ agreedPriceArs: 3000, band: "500_plus" }),
        fact({ agreedPriceArs: 3000, band: "500_plus" }),
      ],
      byId([]),
      RANGE,
      NOW,
    );
    expect(report.kpis.priceIndex).toEqual({ value: 100, previous: 100 });
  });

  it("los mismos envíos más caros suben el índice, y arma todo el reporte", () => {
    const current = fact({ agreedPriceArs: 1040 });
    const report = pricingReport([fact({ firstCompletedAt: BEFORE, publishedAt: BEFORE, agreedPriceArs: 1000 }), current], byId([]), RANGE, NOW);

    expect(report.kpis.priceIndex.value).toBe(104);
    expect(report.kpis.completed).toEqual({ value: 1, previous: 1 });
    expect(report.kpis.captureRate.value).toBe(100);
    expect(report.bridge?.current).toBe(1040);
    expect(report.leakage?.captured.gmvArs).toBe(1040);
    expect(report.breakdowns[0]).toMatchObject({ dimension: "band", metric: "completed", total: { value: 1, previous: 1 } });
    expect(report.series.priceIndex).toHaveLength(2);
  });

  it("sin período anterior no hay índice", () => {
    expect(pricingReport([fact()], byId([]), RANGE, NOW).kpis.priceIndex).toEqual({ value: null, previous: null });
  });
});
