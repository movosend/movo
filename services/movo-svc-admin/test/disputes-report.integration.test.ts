import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { DISPUTES_REPORT_KPIS, DisputesReportSource } from "@movo/shared";
import { buildApp } from "../src/app";
import { createFakePaymentsClient, createFakeShipmentsClient, createFakeSupportClient, createFakeUsersClient } from "./fake-clients";

const points = (values: Array<[number | null, number | null]>) =>
  values.map(([value, previous], index) => ({ start: `2026-10-0${index + 1}`, end: `2026-10-0${index + 1}`, value, previous }));

const kpis = Object.fromEntries(DISPUTES_REPORT_KPIS.map((kpi) => [kpi, { value: 0, previous: 0 }])) as DisputesReportSource["kpis"];
const series = Object.fromEntries(DISPUTES_REPORT_KPIS.map((kpi) => [kpi, points([[0, 0], [0, 0]])])) as DisputesReportSource["series"];

const source: DisputesReportSource = {
  meta: {
    range: { from: "2026-10-01", to: "2026-10-02" },
    previous: { from: "2026-09-29", to: "2026-09-30" },
    granularity: "day",
    generatedAt: "2026-10-03T12:00:00.000Z",
  },
  kpis: { ...kpis, opened: { value: 3, previous: 2 }, disputeRate: { value: 12.5, previous: 10 }, resolutionHours: { value: null, previous: 4 } },
  series: {
    ...series,
    opened: points([[2, 1], [1, 0]]),
    disputeRate: points([[20, 10], [null, 10]]),
  },
  breakdowns: [
    {
      dimension: "reason",
      metric: "opened",
      total: { value: 3, previous: 2 },
      rows: [
        { key: "damaged", value: 2, previous: 1, share: 66.67 },
        { key: "=cmd", value: 1, previous: 1, share: 33.33 },
      ],
    },
    { dimension: "outcome", metric: "resolved", total: { value: 0, previous: 0 }, rows: [{ key: "sender", value: 0, previous: 0, share: null }] },
  ],
  backlog: [
    { status: "open", count: 2, medianAgeHours: 30.5, oldestOpenedAt: "2026-09-01T12:00:00.000Z" },
    { status: "resolving", count: 0, medianAgeHours: null, oldestOpenedAt: null },
  ],
  funnel: [
    { key: "opened", count: 3, previous: 2, medianHoursFromPrevious: null },
    { key: "decided", count: 2, previous: 1, medianHoursFromPrevious: 26.5 },
    { key: "resolved", count: 1, previous: 1, medianHoursFromPrevious: null },
  ],
};

const lines = (body: string) => body.replace(/^﻿/, "").trimEnd().split("\r\n");

/** MOVO-344: reporte de disputas para el panel (`svc-shipments` con un fake, bitácora contra Postgres real). */
describe("GET /admin/reports/disputes — MOVO-344", () => {
  let app: FastifyInstance;
  const viewer = randomUUID();
  const headers = { "x-user-id": viewer, "x-user-roles": "sender,admin", "x-request-id": "req-disputes-report" };
  const seen: Array<{ from: string; to: string; limit?: number }> = [];
  const disputeId = randomUUID();
  const shipmentId = randomUUID();

  const clients = (extra: Partial<NonNullable<Parameters<typeof createFakeShipmentsClient>[0]>> = {}) => ({
    usersClient: createFakeUsersClient({}),
    supportClient: createFakeSupportClient({}).client,
    paymentsClient: createFakePaymentsClient({}).client,
    shipmentsClient: createFakeShipmentsClient({
      disputesReport: source,
      disputesReportSeen: seen,
      disputesReportRows: {
        truncated: false,
        items: [
          {
            disputeId,
            shipmentId,
            reason: "damaged",
            status: "resolved",
            outcome: "partial",
            senderAmountArs: 300,
            carrierAmountArs: 700,
            openedAt: "2026-10-01T12:00:00.000Z",
            resolvedAt: "2026-10-02T12:00:00.000Z",
            resolutionHours: 24,
          },
        ],
      },
      ...extra,
    }),
  });

  const get = (url: string, target: FastifyInstance = app, h: Record<string, string> = headers) => target.inject({ method: "GET", url, headers: h });
  const QUERY = "from=2026-10-01&to=2026-10-02";

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp(clients());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("JSON", () => {
    it("devuelve el reporte con el filtro de distancia marcado como no aplicado, aunque venga", async () => {
      const res = await get(`/admin/reports/disputes?${QUERY}&band=200_500`);
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const body = res.json();
      expect(body.meta).toMatchObject({ band: null, bandApplied: false, granularity: "day" });
      expect(body.kpis.resolutionHours).toEqual({ value: null, previous: 4 });
      expect(body.series.opened[0]).toEqual({ start: "2026-10-01", end: "2026-10-01", value: 2, previous: 1 });
      expect(body.breakdowns[0].rows[0]).toEqual({ key: "damaged", value: 2, previous: 1, share: 66.67 });
      expect(body.backlog).toEqual(source.backlog);
      expect(body.funnel).toEqual(source.funnel);
    });

    it("sin disputas abiertas en el período el embudo llega como null", async () => {
      const empty = buildApp(clients({ disputesReport: { ...source, funnel: null } }));
      await empty.ready();
      try {
        const res = await get(`/admin/reports/disputes?${QUERY}`, empty);
        expect(res.statusCode).toBe(200);
        expect(res.json().funnel).toBeNull();
      } finally {
        await empty.close();
      }
    });

    it("sin extremos pide el rango máximo que termina hoy", async () => {
      seen.length = 0;
      await get("/admin/reports/disputes");
      const [asked] = seen;
      expect(asked?.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((Date.parse(asked?.to ?? "") - Date.parse(asked?.from ?? "")) / 86_400_000).toBe(365);
    });

    it.each([
      ["from=2026-10-05&to=2026-10-01", "inverted"],
      ["from=2024-01-01&to=2026-10-01", "too_long"],
      ["from=ayer", "invalid_date"],
    ])("rango inválido (%s): 400 con el motivo", async (query, reason) => {
      const res = await get(`/admin/reports/disputes?${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({ code: "REPORT_RANGE_INVALID", details: { reason } });
    });

    it("un `band` desconocido es 400", async () => {
      expect((await get(`/admin/reports/disputes?${QUERY}&band=lejos`)).statusCode).toBe(400);
    });

    it("sin el rol admin es 403", async () => {
      expect((await get(`/admin/reports/disputes?${QUERY}`, app, { "x-user-id": viewer, "x-user-roles": "sender" })).statusCode).toBe(403);
    });

    it("si `svc-shipments` no responde, es un error y no un reporte vacío", async () => {
      const down = buildApp(clients({ down: true }));
      await down.ready();
      try {
        expect((await get(`/admin/reports/disputes?${QUERY}`, down)).statusCode).toBeGreaterThanOrEqual(500);
      } finally {
        await down.close();
      }
    });
  });

  describe("CSV", () => {
    it("la tendencia coincide con el JSON para el mismo filtro y cierra con el total", async () => {
      const json = (await get(`/admin/reports/disputes?${QUERY}`)).json();
      const res = await get(`/admin/reports/disputes/export?${QUERY}&section=trend.opened`);

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
      expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="movo-disputas-trend-opened_\d{4}-\d{2}-\d{2}\.csv"$/);
      expect(res.headers["x-export-rows"]).toBe("2");
      expect(res.headers["x-export-truncated"]).toBe("false");
      const [header, ...rows] = lines(res.body);
      expect(header).toBe("period_start,period_end,value,previous,change");
      expect(rows).toEqual(["2026-10-01,2026-10-01,2,1,100", "2026-10-02,2026-10-02,1,0,", "Total,,3,2,50"]);
      const [first] = json.series.opened;
      expect(rows[0]).toContain(`${first.start},${first.end},${first.value},${first.previous}`);
    });

    it("en un porcentaje la variación va en puntos, y un valor indefinido queda vacío", async () => {
      const res = await get(`/admin/reports/disputes/export?${QUERY}&section=trend.disputeRate`);
      expect(lines(res.body).slice(1)).toEqual(["2026-10-01,2026-10-01,20,10,10", "2026-10-02,2026-10-02,,10,", "Total,,12.5,10,2.5"]);
    });

    it("el desglose coincide con el JSON y escapa las celdas", async () => {
      const res = await get(`/admin/reports/disputes/export?${QUERY}&section=breakdown.reason`);
      expect(lines(res.body)).toEqual(["key,value,share,previous,change", "damaged,2,66.67,1,100", "'=cmd,1,33.33,1,0", "Total,3,,2,50"]);
      expect(res.headers["x-export-rows"]).toBe("2");
    });

    it("el backlog sale en su propia sección", async () => {
      const res = await get(`/admin/reports/disputes/export?${QUERY}&section=backlog`);
      expect(lines(res.body)).toEqual([
        "status,count,median_age_hours,oldest_opened_at",
        "open,2,30.5,2026-09-01T12:00:00.000Z",
        "resolving,0,,",
      ]);
    });

    it("el detalle trae solo ids, fechas y montos", async () => {
      const res = await get(`/admin/reports/disputes/export?${QUERY}&section=disputes`);
      expect(lines(res.body)).toEqual([
        "dispute_id,shipment_id,reason,status,outcome,sender_amount_ars,carrier_amount_ars,opened_at,resolved_at,resolution_hours",
        `${disputeId},${shipmentId},damaged,resolved,partial,300,700,2026-10-01T12:00:00.000Z,2026-10-02T12:00:00.000Z,24`,
      ]);
    });

    it("el detalle avisa si se cortó y pide el tope configurado", async () => {
      seen.length = 0;
      const capped = buildApp({
        ...clients({ disputesReportRows: { items: [], truncated: true } }),
        reportsExportMaxRows: 5,
      });
      await capped.ready();
      try {
        const res = await get(`/admin/reports/disputes/export?${QUERY}&section=disputes`, capped);
        expect(res.headers["x-export-truncated"]).toBe("true");
        expect(seen[0]?.limit).toBe(5);
      } finally {
        await capped.close();
      }
    });

    it("sin sección, o con una desconocida, es 400", async () => {
      expect((await get(`/admin/reports/disputes/export?${QUERY}`)).statusCode).toBe(400);
      expect((await get(`/admin/reports/disputes/export?${QUERY}&section=trend.otra`)).statusCode).toBe(400);
    });

    it("cada exportación deja su fila en la bitácora, con los filtros y las filas", async () => {
      const admin = randomUUID();
      await get(`/admin/reports/disputes/export?${QUERY}&section=breakdown.reason`, app, { ...headers, "x-user-id": admin });

      const { items } = (await get(`/admin/audit-log?adminId=${admin}&limit=10`)).json();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        action: "report.export",
        targetType: "report",
        targetId: "disputes",
        outcome: "succeeded",
        context: { filters: { section: "breakdown.reason", from: "2026-10-01", to: "2026-10-02" }, rows: 2, truncated: false },
      });
    });
  });

  it("las dos rutas aparecen en la Swagger del servicio", async () => {
    const paths = Object.keys((app.swagger() as { paths: Record<string, unknown> }).paths);
    expect(paths).toEqual(expect.arrayContaining(["/admin/reports/disputes", "/admin/reports/disputes/export"]));
  });
});
