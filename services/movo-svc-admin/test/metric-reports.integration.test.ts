import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { ADMIN_REPORT_IDS, reportExportSections, ShipmentReportFact, toArgentinaCalendarDateString } from "@movo/shared";
import { buildApp } from "../src/app";
import { createFakePaymentsClient, createFakeShipmentsClient, createFakeSupportClient, createFakeUsersClient } from "./fake-clients";

const value = { value: 1, previous: 2 };
const point = { start: "2026-10-01", end: "2026-10-01", ...value };
const meta = { range: { from: "2026-10-01", to: "2026-10-01" }, previous: { from: "2026-09-30", to: "2026-09-30" }, granularity: "day", generatedAt: "2026-10-03T12:00:00.000Z" };
const body = (kpis: string[]) => ({
  meta,
  kpis: Object.fromEntries(kpis.map((kpi) => [kpi, value])),
  series: Object.fromEntries(kpis.map((kpi) => [kpi, [point]])),
});

const scorecardRow = (band: string) => ({ band, published: value, completionRate: value, onTimeRate: value, assignedWithin24hRate: value, doorToDoorHours: value, avgTicket: value });

const ownedReports = {
  deliveries: {
    ...body(["onTimeRate", "doorToDoorHours", "incidentRate", "lateCount"]),
    breakdowns: [{ dimension: "delayReason", metric: "lateCount", total: value, rows: [{ key: "in_route", ...value, share: 100 }] }],
  },
  carriers: {
    ...body(["assignedWithin24hRate", "timeToAssignHours", "activeCarriers"]),
    breakdowns: [{ dimension: "band", metric: "assignedWithin24hRate", total: value, rows: [{ key: "50_200", ...value, share: null, extra: { timeToAssignHours: 3 } }] }],
    supply: [{ start: "2026-10-01", end: "2026-10-01", published: 4, assignedWithin24h: 2 }],
  },
  distances: {
    ...body(["published", "completionRate", "avgDistanceKm"]),
    breakdowns: [],
    corridors: [
      {
        originCity: "=Córdoba",
        destinationCity: "Rosario",
        originLat: -31.4,
        originLng: -64.2,
        destinationLat: -32.9,
        destinationLng: -60.6,
        distanceKm: 400,
        band: "200_500",
        published: 3,
        publishedPrevious: 2,
        completionRate: 50,
      },
    ],
    scorecard: [scorecardRow("50_200"), scorecardRow("200_500"), scorecardRow("500_plus")],
  },
  support: {
    ...body(["firstResponseMinutes", "conversations", "firstContactResolutionRate"]),
    breakdowns: [{ dimension: "topic", metric: "conversations", total: value, rows: [{ key: "shipment", ...value, share: 100 }] }],
  },
  operations: {
    ...body(["published", "completed", "cancelled", "demandRatio", "highDemandRate", "availableCarriers"]),
    breakdowns: [
      { dimension: "cancelCause", metric: "cancelled", total: value, rows: [{ key: "sender", ...value, share: 100 }] },
      { dimension: "city", metric: "published", total: value, rows: [{ key: "Córdoba", ...value, share: 100, extra: { demandRatio: 1.5, availableCarriers: null } }] },
    ],
    city: null,
    cities: [{ city: "Córdoba", published: 1 }],
  },
};

const finance = {
  ...body(["collected", "shipmentPrice", "commission", "mpFee", "carrierNet", "refunded", "debtGenerated", "debtCollected", "openDebt"]),
  breakdowns: [
    { dimension: "kind", metric: "collected", total: value, rows: [] },
    { dimension: "refundStatus", metric: "refunded", total: value, rows: [] },
    { dimension: "ledgerType", metric: "debtGenerated", total: value, rows: [] },
  ],
  pendingConfirmation: { count: 2, amountArs: 2300 },
  escalated: { count: 0, amountArs: 0 },
  debt: { debtorUsers: 3, creditUsers: 1, creditArs: 150 },
};

const financeRows = {
  items: [
    {
      settlementId: randomUUID(),
      shipmentId: randomUUID(),
      kind: "delivery",
      status: "processing",
      createdAt: "2026-10-01T15:00:00.000Z",
      capturedAt: null,
      grossArs: 1150,
      debtSurchargeArs: 150,
      commissionArs: 150,
      mpFeeArs: null,
      netArs: null,
      refundedArs: 0,
    },
  ],
  truncated: true,
};

const disputes = {
  ...body(["opened", "resolved", "resolutionHours", "disputeRate", "senderAmountArs", "carrierAmountArs"]),
  breakdowns: [
    { dimension: "reason", metric: "opened", total: value, rows: [] },
    { dimension: "outcome", metric: "resolved", total: value, rows: [] },
  ],
  backlog: [],
  funnel: null,
};

const now = new Date().toISOString();
const facts: ShipmentReportFact[] = [
  {
    shipmentId: randomUUID(),
    status: "completed",
    paymentMethod: "card",
    band: "50_200",
    suggestedPriceArs: 1000,
    agreedPriceArs: 1000,
    calculationMethod: "package_tapered_v3",
    breakdown: null,
    publishedAt: now,
    firstAssignedAt: now,
    firstCompletedAt: now,
    deliveredAt: now,
    cancelledBySystem: false,
  },
  {
    shipmentId: randomUUID(),
    status: "completed",
    paymentMethod: "card",
    band: "500_plus",
    suggestedPriceArs: 5000,
    agreedPriceArs: 5000,
    calculationMethod: "package_tapered_v3",
    breakdown: null,
    publishedAt: now,
    firstAssignedAt: now,
    firstCompletedAt: now,
    deliveredAt: now,
    cancelledBySystem: false,
  },
];

const lines = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n");

/** MOVO-35: las rutas de Métricas, con los servicios dueños como fakes y la bitácora contra Postgres real. */
describe("GET /admin/reports/* — MOVO-35", () => {
  let app: FastifyInstance;
  const admin = randomUUID();
  const headers = { "x-user-id": admin, "x-user-roles": "sender,admin", "x-request-id": "req-metric-reports" };
  const seen: Array<{ id: string; band?: string; city?: string }> = [];

  const buildWith = (down = false) =>
    buildApp({
      usersClient: createFakeUsersClient({}),
      supportClient: createFakeSupportClient({}).client,
      paymentsClient: createFakePaymentsClient({ reportFacts: [], financeReport: finance, financeRows, ...(down ? { down: true } : {}) }).client,
      shipmentsClient: createFakeShipmentsClient({ ownedReports, ownedReportsSeen: seen, reportFacts: facts, disputesReport: disputes as never }),
    });

  const get = (url: string, target = app) => target.inject({ method: "GET", url, headers });
  // El rango termina hoy en Argentina, para que los envíos de `now` caigan adentro: uno futuro es 400.
  const today = toArgentinaCalendarDateString(new Date());
  const QUERY = `from=${today}&to=${today}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildWith();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(ADMIN_REPORT_IDS)("%s responde con su forma y exige el rol admin", async (id) => {
    const res = await get(`/admin/reports/${id}?${QUERY}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toMatchObject({ meta: { granularity: expect.any(String) }, kpis: expect.any(Object), series: expect.any(Object) });
    const forbidden = await app.inject({ method: "GET", url: `/admin/reports/${id}?${QUERY}`, headers: { "x-user-id": admin, "x-user-roles": "sender" } });
    expect(forbidden.statusCode).toBe(403);
  });

  it.each(ADMIN_REPORT_IDS)("%s: todas sus secciones de CSV responden", async (id) => {
    for (const section of reportExportSections(id).filter((candidate) => candidate !== "disputes")) {
      const res = await get(`/admin/reports/${id}/export?${QUERY}&section=${section}`);
      expect([section, res.statusCode]).toEqual([section, 200]);
      expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    }
  });

  it("los campos propios de cada reporte no se recortan al serializar", async () => {
    expect((await get(`/admin/reports/carriers?${QUERY}`)).json()).toMatchObject({
      supply: ownedReports.carriers.supply,
      breakdowns: [{ rows: [{ extra: { timeToAssignHours: 3 } }] }],
    });
    const distances = (await get(`/admin/reports/distances?${QUERY}`)).json();
    expect(distances.corridors).toEqual(ownedReports.distances.corridors);
    expect(distances.scorecard).toEqual(ownedReports.distances.scorecard);
    const cashflow = (await get(`/admin/reports/cashflow?${QUERY}`)).json();
    expect(cashflow.pendingCapture).toEqual({ count: 0, amountArs: 0 });
    const pricing = (await get(`/admin/reports/pricing?${QUERY}`)).json();
    expect(pricing.leakage.quoted).toMatchObject({ shipments: 2, gmvArs: 6000 });
    expect(pricing.bridge).toBeNull();
  });

  it("el tramo filtra Cashflow y Precio, y se le pasa al servicio dueño", async () => {
    const cashflow = (await get(`/admin/reports/cashflow?${QUERY}&band=500_plus`)).json();
    expect(cashflow.kpis.gmv.value).toBe(5000);
    expect(cashflow.meta).toMatchObject({ band: "500_plus", bandApplied: true });

    seen.length = 0;
    await get(`/admin/reports/deliveries?${QUERY}&band=200_500`);
    expect(seen).toEqual([{ id: "deliveries", band: "200_500" }]);
  });

  it("Soporte ignora el tramo y lo avisa", async () => {
    seen.length = 0;
    const res = (await get(`/admin/reports/support?${QUERY}&band=200_500`)).json();
    expect(res.meta).toMatchObject({ band: null, bandApplied: false });
    expect(seen).toEqual([{ id: "support" }]);
  });

  it("los CSV de Distancias y Precio tienen las columnas del panel y escapan las celdas", async () => {
    const corridors = lines((await get(`/admin/reports/distances/export?${QUERY}&section=corridors`)).body);
    expect(corridors).toEqual(["origin_city,destination_city,distance_km,band,published,published_previous,change,completion_rate", "'=Córdoba,Rosario,400,200_500,3,2,50,50"]);

    const scorecard = lines((await get(`/admin/reports/distances/export?${QUERY}&section=scorecard`)).body);
    expect(scorecard[0]).toBe(
      "band,published,published_change,completionRate,completionRate_change,onTimeRate,onTimeRate_change,assignedWithin24hRate,assignedWithin24hRate_change,doorToDoorHours,doorToDoorHours_change,avgTicket,avgTicket_change",
    );
    // Un porcentaje va en puntos; el resto, en %.
    expect(scorecard[1]).toBe("50_200,1,-50,1,-1,1,-1,1,-1,1,-50,1,-50");

    const leakage = lines((await get(`/admin/reports/pricing/export?${QUERY}&section=leakage`)).body);
    expect(leakage[0]).toBe("step,timing,shipments,gmv_ars,commission_ars,share_of_quoted");
    expect(leakage[1]).toBe("quoted,,2,6000,900,100");
    expect(leakage.at(-1)).toBe("captured,,2,6000,900,100");

    expect(lines((await get(`/admin/reports/pricing/export?${QUERY}&section=bridge`)).body)).toEqual(["step,amount_ars,cumulative_ars"]);
  });

  it("Operación pasa la ciudad al servicio dueño, ignora el tramo y no recorta sus campos", async () => {
    seen.length = 0;
    const res = await get(`/admin/reports/operations?${QUERY}&city=${encodeURIComponent("Córdoba")}&band=200_500`);
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual([{ id: "operations", city: "Córdoba" }]);
    const report = res.json();
    expect(report.meta).toMatchObject({ band: null, bandApplied: false });
    expect(report.cities).toEqual(ownedReports.operations.cities);
    expect(report.breakdowns[1].rows[0].extra).toEqual({ demandRatio: 1.5, availableCarriers: null });
  });

  it("la ciudad solo existe en Operación: en otro reporte se descarta y no llega al servicio dueño", async () => {
    seen.length = 0;
    expect((await get(`/admin/reports/deliveries?${QUERY}&city=C%C3%B3rdoba`)).statusCode).toBe(200);
    expect(seen).toEqual([{ id: "deliveries" }]);
    expect((await get(`/admin/reports/operations?${QUERY}&city=`)).statusCode).toBe(400);
  });

  it("Finanzas trae lo pendiente de MP aparte, y su CSV de liquidaciones es de ids y montos", async () => {
    const report = (await get(`/admin/reports/finance?${QUERY}`)).json();
    expect(report.pendingConfirmation).toEqual({ count: 2, amountArs: 2300 });
    expect(report.debt).toEqual({ debtorUsers: 3, creditUsers: 1, creditArs: 150 });

    const res = await get(`/admin/reports/finance/export?${QUERY}&section=settlements`);
    expect(res.headers["x-export-truncated"]).toBe("true");
    expect(res.headers["x-export-rows"]).toBe("1");
    const csv = lines(res.body);
    expect(csv[0]).toBe("settlement_id,shipment_id,kind,status,created_at,captured_at,gross_ars,debt_surcharge_ars,commission_ars,mp_fee_ars,net_ars,refunded_ars");
    expect(csv[1]).toContain(",delivery,processing,2026-10-01T15:00:00.000Z,,1150,150,150,,,0");
  });

  it("una sección de otro reporte es 400", async () => {
    expect((await get(`/admin/reports/support/export?${QUERY}&section=corridors`)).statusCode).toBe(400);
    expect((await get(`/admin/reports/cashflow/export?${QUERY}&section=trend.onTimeRate`)).statusCode).toBe(400);
  });

  it("si pagos no responde, Cashflow es un error y no un reporte en cero", async () => {
    const down = buildWith(true);
    await down.ready();
    try {
      expect((await get(`/admin/reports/cashflow?${QUERY}`, down)).statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      await down.close();
    }
  });

  it("cada exportación queda en la bitácora con el reporte como objetivo", async () => {
    const auditor = randomUUID();
    await app.inject({ method: "GET", url: `/admin/reports/carriers/export?${QUERY}&section=trend.activeCarriers`, headers: { ...headers, "x-user-id": auditor } });

    const { items } = (await get(`/admin/audit-log?adminId=${auditor}&limit=10`)).json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ action: "report.export", targetType: "report", targetId: "carriers", outcome: "succeeded" });
  });

  it("las rutas aparecen en la Swagger del servicio", async () => {
    const paths = Object.keys((app.swagger() as { paths: Record<string, unknown> }).paths);
    for (const id of ADMIN_REPORT_IDS) {
      expect(paths).toEqual(expect.arrayContaining([`/admin/reports/${id}`, `/admin/reports/${id}/export`]));
    }
  });
});
