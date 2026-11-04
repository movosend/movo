import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { DisputeReason, DisputesReportRowsResponse, DisputesReportSource, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { PackageType } from "../src/models/shipment";
import { createDisputeRepository } from "../src/repositories/dispute-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient } from "./fake-payments-client";
import { createFakePricingClient } from "./fake-pricing-client";
import { createFakePricingLogisticsClient } from "./fake-pricing-logistics-client";

// Mediodía de Argentina (UTC-3) del día pedido.
const noon = (day: string, plusHours = 0) => new Date(new Date(`${day}T15:00:00.000Z`).getTime() + plusHours * 3_600_000);

/** MOVO-344: agregados del reporte de disputas, contra Postgres real con fechas fijas. */
describe("reporte de disputas (Postgres) — MOVO-344", () => {
  let app: FastifyInstance;
  let shipments: ShipmentRepository;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({
      usersClient: createFakeUsersClient({}),
      paymentsClient: createFakePaymentsClient(),
      pricingClient: createFakePricingClient(),
      pricingLogisticsClient: createFakePricingLogisticsClient(),
      sweepEnabled: false,
      orphanPhotoSweepEnabled: false,
      tripExpirySweepEnabled: false,
      transitAnomalySweepEnabled: false,
      pickupMissedSweepEnabled: false,
    });
    await app.ready();
    shipments = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  async function shipment(status = ShipmentStatus.DISPUTED) {
    const created = await shipments.create({
      senderId: randomUUID(),
      receiverId: randomUUID(),
      packageType: PackageType.standard_package,
      weightKg: 1,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      description: "Caja",
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupLat: -31.42,
      pickupLng: -64.18,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: -31.41,
      deliveryLng: -64.18,
      pickupDate: new Date("2031-06-01T00:00:00.000Z"),
      pickupTimeWindowStart: new Date("1970-01-01T14:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T18:00:00.000Z"),
      suggestedPriceArs: 1000,
    });
    await app.db.shipment.update({ where: { id: created.id }, data: { status } });
    return created.id;
  }

  async function dispute(reason: DisputeReason, openedAt: Date, data: Record<string, unknown> = {}) {
    const row = await app.db.dispute.create({
      data: { shipmentId: await shipment(), reason, description: "texto libre", openedAt, ...data },
    });
    return row.id;
  }

  const resolved = (outcome: "sender" | "carrier" | "partial", resolvedAt: Date, senderAmountArs: number, carrierAmountArs: number) => ({
    status: "resolved",
    outcome,
    resolvedAt,
    senderAmountArs,
    carrierAmountArs,
    reasoning: "razonamiento",
    resolvedBy: randomUUID(),
  });

  async function completion(at: Date, shipmentId?: string) {
    const id = shipmentId ?? (await shipment(ShipmentStatus.COMPLETED));
    await app.db.shipmentEvent.create({ data: { shipmentId: id, toStatus: "completed", createdAt: at } });
    return id;
  }

  const report = async (from: string, to: string): Promise<DisputesReportSource> => {
    const response = await app.inject({ method: "GET", url: `/internal/admin/reports/disputes?from=${from}&to=${to}` });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  const breakdown = (body: DisputesReportSource, dimension: string) => {
    const found = body.breakdowns.find((candidate) => candidate.dimension === dimension);
    if (!found) throw new Error(`Falta el desglose ${dimension}`);
    return found;
  };

  it("vacío: cuentas en cero, lo indefinido en null y los desgloses con todas sus filas", async () => {
    const body = await report("2026-10-01", "2026-10-02");

    expect(body.kpis.opened).toEqual({ value: 0, previous: 0 });
    expect(body.kpis.resolutionHours).toEqual({ value: null, previous: null });
    expect(body.kpis.disputeRate).toEqual({ value: null, previous: null });
    expect(body.series.opened).toEqual([
      { start: "2026-10-01", end: "2026-10-01", value: 0, previous: 0 },
      { start: "2026-10-02", end: "2026-10-02", value: 0, previous: 0 },
    ]);
    expect(breakdown(body, "reason").rows.map((row) => row.key).sort()).toEqual(Object.values(DisputeReason).sort());
    expect(breakdown(body, "outcome").rows.map((row) => row.key).sort()).toEqual(["carrier", "partial", "sender"]);
    expect(breakdown(body, "reason").rows.every((row) => row.share === null)).toBe(true);
    expect(body.backlog).toEqual([
      { status: "open", count: 0, medianAgeHours: null, oldestOpenedAt: null },
      { status: "resolving", count: 0, medianAgeHours: null, oldestOpenedAt: null },
    ]);
  });

  it("resuelve con sender, carrier y partial: motivo, resultado, mediana y montos", async () => {
    await dispute(DisputeReason.DAMAGED, noon("2026-10-01"), resolved("sender", noon("2026-10-01", 2), 1000, 0));
    await dispute(DisputeReason.DAMAGED, noon("2026-10-01"), resolved("carrier", noon("2026-10-01", 4), 0, 2000));
    await dispute(DisputeReason.OTHER, noon("2026-10-02"), resolved("partial", noon("2026-10-02", 8), 300, 700));

    const body = await report("2026-10-01", "2026-10-02");

    expect(body.kpis.opened.value).toBe(3);
    expect(body.kpis.resolved.value).toBe(3);
    expect(body.kpis.resolutionHours.value).toBe(4);
    expect(body.kpis.senderAmountArs.value).toBe(1300);
    expect(body.kpis.carrierAmountArs.value).toBe(2700);
    expect(breakdown(body, "outcome").rows.map(({ key, value }) => [key, value])).toEqual([
      ["carrier", 1],
      ["partial", 1],
      ["sender", 1],
    ]);
    expect(breakdown(body, "reason").rows[0]).toMatchObject({ key: DisputeReason.DAMAGED, value: 2, share: 66.67 });
    expect(body.series.resolutionHours.map((point) => point.value)).toEqual([3, 8]);
    expect(body.series.resolved.map((point) => point.value)).toEqual([2, 1]);
  });

  it("una disputa con el pago pendiente no cuenta como resuelta: sí como abierta y en el backlog", async () => {
    const waiting = { status: "resolving", outcome: "sender", senderAmountArs: 1000, carrierAmountArs: 0 };
    await dispute(DisputeReason.DAMAGED, noon("2026-10-01"), waiting);

    const body = await report("2026-10-01", "2026-10-01");

    expect(body.kpis.opened.value).toBe(1);
    expect(body.kpis.resolved.value).toBe(0);
    expect(body.kpis.resolutionHours.value).toBeNull();
    expect(body.kpis.senderAmountArs.value).toBe(0);
    expect(breakdown(body, "outcome").rows.every((row) => row.value === 0)).toBe(true);
    expect(body.backlog[1]).toMatchObject({ status: "resolving", count: 1, oldestOpenedAt: noon("2026-10-01").toISOString() });
  });

  it("abierta en un rango y resuelta en otro: cada cuenta va por su fecha", async () => {
    await dispute(DisputeReason.DAMAGED, noon("2026-10-01"), resolved("sender", noon("2026-10-05"), 100, 0));

    const opening = await report("2026-10-01", "2026-10-02");
    const closing = await report("2026-10-05", "2026-10-06");

    expect([opening.kpis.opened.value, opening.kpis.resolved.value]).toEqual([1, 0]);
    expect([closing.kpis.opened.value, closing.kpis.resolved.value]).toEqual([0, 1]);
    expect(closing.kpis.resolutionHours.value).toBe(96);
  });

  it("los días son de Argentina: las 23:30 del 2 van al 2 aunque en UTC ya sea el 3", async () => {
    await dispute(DisputeReason.DAMAGED, new Date("2026-10-03T02:30:00.000Z"));
    await dispute(DisputeReason.DAMAGED, new Date("2026-10-03T03:00:00.000Z"));

    const body = await report("2026-10-02", "2026-10-03");

    expect(body.series.opened.map((point) => point.value)).toEqual([1, 1]);
  });

  it("compara contra el período anterior, en total, por bucket y en el desglose", async () => {
    await dispute(DisputeReason.DAMAGED, noon("2026-09-29"));
    await dispute(DisputeReason.OTHER, noon("2026-09-30"));
    await dispute(DisputeReason.DAMAGED, noon("2026-10-01"));
    await dispute(DisputeReason.DAMAGED, noon("2026-09-27")); // Antes del período anterior: no cuenta.

    const body = await report("2026-10-01", "2026-10-02");

    expect(body.meta.previous).toEqual({ from: "2026-09-29", to: "2026-09-30" });
    expect(body.kpis.opened).toEqual({ value: 1, previous: 2 });
    expect(body.series.opened.map(({ value, previous }) => [value, previous])).toEqual([
      [1, 1],
      [0, 1],
    ]);
    expect(breakdown(body, "reason").rows.find((row) => row.key === DisputeReason.DAMAGED)).toMatchObject({ value: 1, previous: 1 });
    expect(breakdown(body, "reason").rows.find((row) => row.key === DisputeReason.OTHER)).toMatchObject({ value: 0, previous: 1 });
  });

  it("la tasa es por cada 100 completados, y un envío que vuelve a completarse cuenta una vez, por la primera", async () => {
    const reclosed = await completion(noon("2026-10-01"));
    await completion(noon("2026-10-01", 1), reclosed);
    await completion(noon("2026-10-01"));
    await completion(noon("2026-10-01"));
    await completion(noon("2026-10-02"));
    // Primera vez antes del rango: que se cierre de nuevo adentro no lo suma.
    const earlier = await completion(noon("2026-09-01"));
    await completion(noon("2026-10-02"), earlier);
    await dispute(DisputeReason.DAMAGED, noon("2026-10-02"));

    const body = await report("2026-10-01", "2026-10-02");

    expect(body.kpis.disputeRate.value).toBe(25);
    expect(body.series.disputeRate.map((point) => point.value)).toEqual([0, 100]);
  });

  it("el backlog es una foto: una abierta vieja aparece aunque esté fuera del rango", async () => {
    await dispute(DisputeReason.DAMAGED, noon("2026-01-01"));

    const body = await report("2026-10-01", "2026-10-02");

    expect(body.kpis.opened.value).toBe(0);
    expect(body.backlog[0]).toMatchObject({ status: "open", count: 1, oldestOpenedAt: noon("2026-01-01").toISOString() });
    expect(body.backlog[0]?.medianAgeHours).toBeGreaterThan(0);
  });

  it("agrupa por semana y por mes según el largo del rango", async () => {
    await dispute(DisputeReason.DAMAGED, noon("2026-08-02"));
    await dispute(DisputeReason.DAMAGED, noon("2026-08-09"));

    const weekly = await report("2026-08-01", "2026-09-10");
    const monthly = await report("2026-05-01", "2026-09-30");

    expect(weekly.meta.granularity).toBe("week");
    expect(weekly.series.opened.slice(0, 2).map((point) => point.value)).toEqual([1, 1]);
    expect(monthly.meta.granularity).toBe("month");
    expect(monthly.series.opened.map(({ start, value }) => [start, value])).toEqual([
      ["2026-05-01", 0],
      ["2026-06-01", 0],
      ["2026-07-01", 0],
      ["2026-08-01", 2],
      ["2026-09-01", 0],
    ]);
  });

  describe("embudo", () => {
    const decided = (decidedAt: Date) => ({ status: "resolving", outcome: "sender", senderAmountArs: 1000, carrierAmountArs: 0, decidedAt });
    const closed = (decidedAt: Date, resolvedAt: Date) => ({ ...resolved("partial", resolvedAt, 300, 700), decidedAt });

    it("sin disputas abiertas en el período es null, aunque se haya resuelto una vieja o haya en el anterior", async () => {
      await dispute(DisputeReason.DAMAGED, noon("2026-09-30"), closed(noon("2026-09-30", 1), noon("2026-10-01")));

      expect((await report("2026-10-01", "2026-10-02")).funnel).toBeNull();
    });

    it("sigue a la cohorte hasta su estado actual, con las medianas entre etapas y el período anterior", async () => {
      await dispute(DisputeReason.DAMAGED, noon("2026-10-01"));
      await dispute(DisputeReason.DAMAGED, noon("2026-10-01"), decided(noon("2026-10-01", 4)));
      await dispute(DisputeReason.OTHER, noon("2026-10-01"), closed(noon("2026-10-01", 2), noon("2026-10-01", 3)));
      // Se decidió y resolvió después del rango: es de la cohorte igual.
      await dispute(DisputeReason.OTHER, noon("2026-10-02"), closed(noon("2026-10-02", 6), noon("2026-10-05")));
      await dispute(DisputeReason.OTHER, noon("2026-09-30"), closed(noon("2026-09-30", 1), noon("2026-09-30", 2)));
      await dispute(DisputeReason.OTHER, noon("2026-09-29"));

      const { funnel } = await report("2026-10-01", "2026-10-02");

      expect(funnel).toEqual([
        { key: "opened", count: 4, previous: 2, medianHoursFromPrevious: null },
        { key: "decided", count: 3, previous: 1, medianHoursFromPrevious: 4 },
        { key: "resolved", count: 2, previous: 1, medianHoursFromPrevious: 33.5 },
      ]);
    });

    it("una disputa anterior a `decided_at` cuenta en las etapas pero no en las medianas", async () => {
      await dispute(DisputeReason.DAMAGED, noon("2026-10-01"), resolved("sender", noon("2026-10-01", 2), 1000, 0));

      const { funnel } = await report("2026-10-01", "2026-10-01");

      expect(funnel?.map(({ count, previous, medianHoursFromPrevious }) => [count, previous, medianHoursFromPrevious])).toEqual([
        [1, 0, null],
        [1, 0, null],
        [1, 0, null],
      ]);
    });

    it("decidir la guarda en la disputa, y abortar la resolución la saca de la etapa", async () => {
      const id = await dispute(DisputeReason.DAMAGED, noon("2026-10-01"));
      const disputes = createDisputeRepository(app.db);
      await disputes.beginResolution({
        disputeId: id,
        outcome: "sender",
        percentage: null,
        carrierAmountArs: 0,
        senderAmountArs: 1000,
        paymentAction: "none",
        reasoning: "razonamiento",
        resolvedBy: randomUUID(),
      });

      const before = await app.db.dispute.findUniqueOrThrow({ where: { id } });
      expect(before.decidedAt).toBeInstanceOf(Date);
      expect((await report("2026-10-01", "2026-10-01")).funnel?.[1]?.count).toBe(1);

      await disputes.abortResolution(id);

      const after = await app.db.dispute.findUniqueOrThrow({ where: { id } });
      expect(after.decidedAt).toBeNull();
      expect((await report("2026-10-01", "2026-10-01")).funnel?.[1]).toMatchObject({ count: 0, medianHoursFromPrevious: null });
    });
  });

  it("un rango inválido es 400", async () => {
    const response = await app.inject({ method: "GET", url: "/internal/admin/reports/disputes?from=2026-10-05&to=2026-10-01" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("REPORT_RANGE_INVALID");
  });

  describe("filas del CSV", () => {
    const rows = async (from: string, to: string, limit = 100): Promise<DisputesReportRowsResponse> => {
      const response = await app.inject({ method: "GET", url: `/internal/admin/reports/disputes/rows?from=${from}&to=${to}&limit=${limit}` });
      expect(response.statusCode).toBe(200);
      return response.json();
    };

    it("trae las abiertas o resueltas en el rango, de la más nueva a la más vieja, sin datos personales", async () => {
      const inRange = await dispute(DisputeReason.DAMAGED, noon("2026-10-02"), { openedBy: randomUUID() });
      const closedInRange = await dispute(DisputeReason.OTHER, noon("2026-09-01"), resolved("partial", noon("2026-10-01"), 300, 700));
      await dispute(DisputeReason.OTHER, noon("2026-09-01"));

      const { items, truncated } = await rows("2026-10-01", "2026-10-02");

      expect(truncated).toBe(false);
      expect(items.map((row) => row.disputeId)).toEqual([inRange, closedInRange]);
      expect(items[1]).toMatchObject({ outcome: "partial", senderAmountArs: 300, carrierAmountArs: 700 });
      expect(Object.keys(items[0] as object).sort()).toEqual(
        ["carrierAmountArs", "disputeId", "openedAt", "outcome", "reason", "resolutionHours", "resolvedAt", "senderAmountArs", "shipmentId", "status"].sort(),
      );
    });

    it("una `resolving` no muestra resultado ni montos todavía", async () => {
      await dispute(DisputeReason.DAMAGED, noon("2026-10-01"), { status: "resolving", outcome: "sender", senderAmountArs: 1000, carrierAmountArs: 0 });

      const { items } = await rows("2026-10-01", "2026-10-01");

      expect(items[0]).toMatchObject({ status: "resolving", outcome: null, senderAmountArs: null, carrierAmountArs: null, resolutionHours: null });
    });

    it("corta en el tope, conserva las más nuevas y avisa", async () => {
      await dispute(DisputeReason.DAMAGED, noon("2026-10-01"));
      const newest = await dispute(DisputeReason.DAMAGED, noon("2026-10-02"));

      const { items, truncated } = await rows("2026-10-01", "2026-10-02", 1);

      expect(truncated).toBe(true);
      expect(items.map((row) => row.disputeId)).toEqual([newest]);
    });
  });
});
