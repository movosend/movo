import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { CarriersReport, DeliveriesReport, DisputeReason, DisputesReportSource, DistancesReport, ReportSource, ShipmentReportFactsResponse, ShipmentStatus, SupportReport } from "@movo/shared";
import { buildApp } from "../src/app";
import { roadDistanceEstimateKm } from "../src/domain/geo";
import { PackageType } from "../src/models/shipment";
import { quoteShipment } from "../src/modules/shipments/shipment-quote";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient } from "./fake-payments-client";
import { createFakePricingClient } from "./fake-pricing-client";
import { createFakePricingLogisticsClient } from "./fake-pricing-logistics-client";

// Mediodía de Argentina (UTC-3) del día pedido.
const noon = (day: string, plusHours = 0) => new Date(new Date(`${day}T15:00:00.000Z`).getTime() + plusHours * 3_600_000);

const FROM = "2026-10-01";
const TO = "2026-10-02";

interface Options {
  distanceKm?: number;
  pickupDate?: string;
  pickupCity?: string;
  deliveryCity?: string;
  agreedPriceArs?: number;
  estimatedDeliveryDate?: string;
  deliveredAt?: Date;
  anomaly?: boolean;
  published?: Date;
  assigned?: Date;
  pickedUp?: Date;
  completed?: Date;
}

/** MOVO-35: reportes de Métricas que calcula `svc-shipments`, contra Postgres real con fechas fijas. */
describe("reportes de Métricas (Postgres) — MOVO-35", () => {
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
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments, shipments.trips, shipments.support_conversations RESTART IDENTITY CASCADE");
  });

  async function shipment(options: Options = {}) {
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
      pickupCity: options.pickupCity ?? null,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: -31.41,
      deliveryLng: -64.18,
      deliveryCity: options.deliveryCity ?? null,
      pickupDate: new Date(`${options.pickupDate ?? "2031-06-01"}T00:00:00.000Z`),
      pickupTimeWindowStart: new Date("1970-01-01T14:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T18:00:00.000Z"),
      suggestedPriceArs: 1000,
      calculationMethod: "package_tapered_v3",
      highDemand: false,
      distanceKm: options.distanceKm ?? 100,
    });
    await app.db.shipment.update({
      where: { id: created.id },
      data: {
        status: options.deliveredAt ? ShipmentStatus.DELIVERED : ShipmentStatus.PUBLISHED,
        ...(options.agreedPriceArs ? { agreedPriceArs: options.agreedPriceArs } : {}),
        ...(options.estimatedDeliveryDate
          ? { estimatedDeliveryDate: new Date(`${options.estimatedDeliveryDate}T00:00:00.000Z`), estimatedDeliveryTimeWindowEnd: "20:00:00" }
          : {}),
        ...(options.deliveredAt ? { deliveredAt: options.deliveredAt } : {}),
        ...(options.anomaly ? { transitAnomalyFlaggedAt: options.deliveredAt ?? new Date() } : {}),
      },
    });
    const events: Array<[string, Date | undefined]> = [
      ["published", options.published],
      ["assigned", options.assigned],
      ["in_transit", options.pickedUp],
      ["completed", options.completed],
    ];
    for (const [toStatus, createdAt] of events) {
      if (createdAt) await app.db.shipmentEvent.create({ data: { shipmentId: created.id, toStatus: toStatus as ShipmentStatus, createdAt } });
    }
    return created.id;
  }

  async function get<T>(report: string, query = ""): Promise<T> {
    const response = await app.inject({ method: "GET", url: `/internal/admin/reports/${report}?from=${FROM}&to=${TO}${query}` });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  describe("Entregas", () => {
    it("mide contra la franja estimada y le da un solo motivo a cada envío tarde", async () => {
      const pickedUp = noon("2026-10-01");
      // A tiempo.
      await shipment({ pickedUp, deliveredAt: noon("2026-10-01", 2), estimatedDeliveryDate: "2026-10-01" });
      // Tarde con anomalía, aunque también retiró tarde: gana la anomalía.
      await shipment({ pickedUp, pickupDate: "2026-09-20", anomaly: true, deliveredAt: noon("2026-10-02"), estimatedDeliveryDate: "2026-10-01" });
      // Tarde por retiro fuera de ventana.
      await shipment({ pickedUp, pickupDate: "2026-09-20", deliveredAt: noon("2026-10-02", 4), estimatedDeliveryDate: "2026-10-01" });
      // Tarde en ruta.
      await shipment({ pickedUp, deliveredAt: noon("2026-10-02", 6), estimatedDeliveryDate: "2026-10-01" });
      // Sin franja: no cuenta ni a tiempo ni tarde. Con disputa: es un incidente.
      const noEstimate = await shipment({ pickedUp, deliveredAt: noon("2026-10-01", 1) });
      await app.db.dispute.create({ data: { shipmentId: noEstimate, reason: DisputeReason.DAMAGED, description: "texto" } });

      const body = await get<ReportSource<DeliveriesReport>>("deliveries");

      expect(body.kpis.onTimeRate.value).toBe(25);
      expect(body.kpis.lateCount.value).toBe(3);
      expect(body.kpis.incidentRate.value).toBe(40);
      expect(body.kpis.doorToDoorHours.value).toBe(24);
      const rows = Object.fromEntries((body.breakdowns[0]?.rows ?? []).map((row) => [row.key, row.value]));
      expect(rows).toEqual({ gps_anomaly: 1, pickup_late: 1, in_route: 1, receiver_absent: 0 });
      expect(body.series.lateCount.map((point) => point.value)).toEqual([0, 3]);
    });

    it("sin entregas, las tasas son null y las cuentas 0", async () => {
      const body = await get<ReportSource<DeliveriesReport>>("deliveries");
      expect(body.kpis.onTimeRate).toEqual({ value: null, previous: null });
      expect(body.kpis.lateCount).toEqual({ value: 0, previous: 0 });
    });

    it("el filtro de distancia deja solo los envíos del tramo", async () => {
      await shipment({ distanceKm: 100, deliveredAt: noon("2026-10-01"), estimatedDeliveryDate: "2026-09-20" });
      await shipment({ distanceKm: 300, deliveredAt: noon("2026-10-01"), estimatedDeliveryDate: "2026-09-20" });

      expect((await get<ReportSource<DeliveriesReport>>("deliveries", "&band=200_500")).kpis.lateCount.value).toBe(1);
      expect((await get<ReportSource<DeliveriesReport>>("deliveries")).kpis.lateCount.value).toBe(2);
    });
  });

  describe("Transportistas", () => {
    it("mide asignación en 24 h, tiempo hasta asignar, oferta contra demanda y transportistas activos", async () => {
      const published = noon("2026-10-01");
      await shipment({ published, assigned: noon("2026-10-01", 2), distanceKm: 100 });
      await shipment({ published, assigned: noon("2026-10-01", 30), distanceKm: 300 });
      await shipment({ published: noon("2026-10-02"), distanceKm: 100 });
      await shipment({ published: noon("2026-10-02"), assigned: noon("2026-10-02", 1), distanceKm: 100 });

      const carrier = randomUUID();
      const offered = await shipment({ distanceKm: 300 });
      await app.db.offer.create({
        data: { shipmentId: offered, carrierId: carrier, priceOffered: 1000, offeredDate: new Date("2026-10-05T00:00:00.000Z"), createdAt: noon("2026-10-01") },
      });
      await app.db.trip.create({
        data: {
          carrierId: randomUUID(),
          originAddress: "A",
          originLat: -31.4,
          originLng: -64.1,
          destinationAddress: "B",
          destinationLat: -32.9,
          destinationLng: -60.6,
          departureAt: noon("2026-10-01"),
          vehicleType: "auto",
        },
      });

      const body = await get<ReportSource<CarriersReport>>("carriers");

      expect(body.kpis.assignedWithin24hRate.value).toBe(50);
      expect(body.kpis.timeToAssignHours.value).toBe(2);
      // Dos transportistas el primer día, ninguno el segundo.
      expect(body.kpis.activeCarriers.value).toBe(1);
      expect(body.supply).toEqual([
        { start: FROM, end: FROM, published: 2, assignedWithin24h: 1 },
        { start: TO, end: TO, published: 2, assignedWithin24h: 1 },
      ]);
      const near = body.breakdowns[0]?.rows.find((row) => row.key === "50_200");
      expect(near).toMatchObject({ value: 66.67, extra: { timeToAssignHours: 1.5 } });

      // Con tramo, la oferta al envío de 300 km y el viaje Córdoba-Rosario, que por su ruta cae en el mismo tramo.
      const banded = await get<ReportSource<CarriersReport>>("carriers", "&band=200_500");
      expect(banded.kpis.activeCarriers.value).toBe(1);
      expect((await get<ReportSource<CarriersReport>>("carriers", "&band=500_plus")).kpis.activeCarriers.value).toBe(0);
      expect(banded.kpis.assignedWithin24hRate.value).toBe(0);
    });
  });

  describe("Distancias", () => {
    it("arma corredores ordenados y el scorecard de los tres tramos, que ignora el filtro", async () => {
      const route = { pickupCity: "Córdoba", deliveryCity: "Rosario", distanceKm: 400 };
      await shipment({ ...route, published: noon("2026-10-01"), completed: noon("2026-10-02"), agreedPriceArs: 2000 });
      await shipment({ ...route, published: noon("2026-10-01") });
      await shipment({ ...route, published: noon("2026-09-30") });
      await shipment({ pickupCity: "Córdoba", deliveryCity: "Carlos Paz", distanceKm: 40, published: noon("2026-10-01") });
      await shipment({ pickupCity: null as unknown as string, published: noon("2026-10-01"), distanceKm: 700 });

      const body = await get<ReportSource<DistancesReport>>("distances");

      expect(body.kpis.published).toEqual({ value: 4, previous: 1 });
      expect(body.kpis.completionRate.value).toBe(25);
      expect(body.kpis.avgDistanceKm.value).toBe(385);
      expect(body.corridors.map(({ originCity, destinationCity, band, published, publishedPrevious, completionRate }) => [originCity, destinationCity, band, published, publishedPrevious, completionRate])).toEqual([
        ["Córdoba", "Rosario", "200_500", 2, 1, 50],
        ["Córdoba", "Carlos Paz", "50_200", 1, 0, 0],
      ]);
      expect(body.corridors[0]?.originLat).toBe(-31.42);
      expect(body.scorecard.map((row) => row.band)).toEqual(["50_200", "200_500", "500_plus"]);
      expect(body.scorecard[1]).toMatchObject({ published: { value: 2, previous: 1 }, completionRate: { value: 50 }, avgTicket: { value: 2000 } });

      const banded = await get<ReportSource<DistancesReport>>("distances", "&band=50_200");
      expect(banded.kpis.published.value).toBe(1);
      expect(banded.corridors).toHaveLength(1);
      expect(banded.scorecard[1]?.published.value).toBe(2);
    });
  });

  describe("Soporte", () => {
    async function conversation(topic: "shipment" | "payments", createdAt: Date, firstAgentMinutes: number | null, options: { resolved?: boolean; userReturned?: boolean } = {}) {
      const row = await app.db.supportConversation.create({
        data: { userId: randomUUID(), topic, createdAt, ...(options.resolved ? { resolvedAt: new Date(createdAt.getTime() + 3_600_000 * 3) } : {}) },
      });
      await app.db.supportMessage.create({ data: { conversationId: row.id, kind: "user", body: "hola", createdAt } });
      if (firstAgentMinutes !== null) {
        const agentAt = new Date(createdAt.getTime() + firstAgentMinutes * 60_000);
        await app.db.supportMessage.create({ data: { conversationId: row.id, kind: "agent", body: "hola", createdAt: agentAt } });
        if (options.userReturned) {
          await app.db.supportMessage.create({ data: { conversationId: row.id, kind: "user", body: "otra", createdAt: new Date(agentAt.getTime() + 60_000) } });
        }
      }
    }

    it("mide primera respuesta, conversaciones por tema y resolución en el primer contacto", async () => {
      await conversation("shipment", noon("2026-10-01"), 10, { resolved: true });
      await conversation("shipment", noon("2026-10-01"), 30, { resolved: true, userReturned: true });
      await conversation("payments", noon("2026-10-02"), null);
      await conversation("payments", noon("2026-09-30"), 5);

      const body = await get<ReportSource<SupportReport>>("support");

      expect(body.kpis.conversations).toEqual({ value: 3, previous: 1 });
      expect(body.kpis.firstResponseMinutes.value).toBe(20);
      expect(body.kpis.firstContactResolutionRate.value).toBe(50);
      expect(body.breakdowns[0]?.rows.slice(0, 2).map(({ key, value, previous }) => [key, value, previous])).toEqual([
        ["shipment", 2, 0],
        ["payments", 1, 1],
      ]);
      expect(body.breakdowns[0]?.rows.map((row) => row.key).sort()).toEqual(["account", "carrier", "payments", "security", "shipment"]);
    });
  });

  describe("Disputas por tramo", () => {
    it("el filtro alcanza a las cuentas, los desgloses, el embudo y el denominador de la tasa", async () => {
      const near = await shipment({ distanceKm: 100, completed: noon("2026-10-01") });
      const far = await shipment({ distanceKm: 600, completed: noon("2026-10-01") });
      await shipment({ distanceKm: 600, completed: noon("2026-10-01") });
      await app.db.dispute.create({ data: { shipmentId: near, reason: DisputeReason.DAMAGED, description: "x", openedAt: noon("2026-10-01") } });
      await app.db.dispute.create({ data: { shipmentId: far, reason: DisputeReason.OTHER, description: "x", openedAt: noon("2026-10-01") } });

      const body = await get<DisputesReportSource>("disputes", "&band=500_plus");

      expect(body.kpis.opened.value).toBe(1);
      expect(body.kpis.disputeRate.value).toBe(50);
      expect(body.breakdowns[0]?.rows.find((row) => row.key === DisputeReason.DAMAGED)?.value).toBe(0);
      expect(body.funnel?.[0]?.count).toBe(1);
      expect(body.backlog[0]?.count).toBe(1);

      const rows = await app.inject({ method: "GET", url: `/internal/admin/reports/disputes/rows?from=${FROM}&to=${TO}&limit=10&band=50_200` });
      expect(rows.json().items.map((row: { shipmentId: string }) => row.shipmentId)).toEqual([near]);
    });
  });

  describe("datos por envío para Cashflow y Precio", () => {
    it("trae los envíos del rango y del período anterior, y marca la cancelación del sistema", async () => {
      const inRange = await shipment({ published: noon("2026-10-01"), distanceKm: 300, agreedPriceArs: 1500, completed: noon("2026-10-02") });
      const before = await shipment({ published: noon("2026-09-29") });
      await shipment({ published: noon("2026-09-01") });
      await app.db.shipmentEvent.create({ data: { shipmentId: before, toStatus: ShipmentStatus.CANCELLED, createdAt: noon("2026-09-30") } });

      const { items } = await get<ShipmentReportFactsResponse>("shipment-facts");

      expect(items.map((item) => item.shipmentId).sort()).toEqual([inRange, before].sort());
      expect(items.find((item) => item.shipmentId === inRange)).toMatchObject({ band: "200_500", agreedPriceArs: 1500, suggestedPriceArs: 1000, firstCompletedAt: noon("2026-10-02").toISOString() });
      expect(items.find((item) => item.shipmentId === before)?.cancelledBySystem).toBe(true);
    });

    it("un rango inválido es 400", async () => {
      const response = await app.inject({ method: "GET", url: "/internal/admin/reports/shipment-facts?from=2026-10-05&to=2026-10-01" });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("persistencia al crear", () => {
    it("guarda la distancia y el desglose", async () => {
      const breakdown = {
        distanceKm: 412.5,
        distanceSource: "routes_api" as const,
        fuelArsPerLiter: 1500,
        fuelSource: "api" as const,
        perKmArs: 100,
        base: 1000,
        distance: 5000,
        weight: 500,
        packageFactor: 1,
        demandRatio: 0,
        demandMultiplier: 1,
      };
      const created = await shipments.create({
        senderId: randomUUID(),
        receiverId: randomUUID(),
        packageType: PackageType.standard_package,
        weightKg: 1,
        lengthCm: 10,
        widthCm: 10,
        heightCm: 10,
        description: "Caja",
        pickupAddress: "A",
        pickupLat: -31.42,
        pickupLng: -64.18,
        deliveryAddress: "B",
        deliveryLat: -32.9,
        deliveryLng: -60.6,
        pickupDate: new Date("2031-06-01T00:00:00.000Z"),
        pickupTimeWindowStart: new Date("1970-01-01T14:00:00.000Z"),
        pickupTimeWindowEnd: new Date("1970-01-01T18:00:00.000Z"),
        suggestedPriceArs: 1000,
        calculationMethod: "package_tapered_v3",
        highDemand: false,
        distanceKm: breakdown.distanceKm,
        quoteBreakdown: breakdown,
      });

      const row = await app.db.shipment.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.distanceKm?.toNumber()).toBe(412.5);
      expect(row.quoteBreakdown).toMatchObject({ fuelArsPerLiter: 1500, demandMultiplier: 1 });
    });

    it("la cotización siempre pide el desglose", async () => {
      const seen: Array<{ includeBreakdown?: boolean }> = [];
      await quoteShipment(
        {
          shipmentRepository: { countPublishedNearPickup: async () => 0 },
          pricingClient: {
            getQuote: async (input) => {
              seen.push(input);
              return { suggestedPriceArs: 1000, calculationMethod: null, highDemand: null };
            },
          },
        },
        { originLat: -31.4, originLng: -64.1, destinationLat: -32.9, destinationLng: -60.6, weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1, packageType: PackageType.standard_package } as never,
      );
      expect(seen[0]?.includeBreakdown).toBe(true);
    });

    it("sin cotización, la distancia sale de la línea recta con el factor de desvío", () => {
      expect(roadDistanceEstimateKm(-31.42, -64.18, -31.42, -64.18)).toBe(0);
      const straight = roadDistanceEstimateKm(-31.42, -64.18, -32.95, -60.64);
      expect(straight).toBeGreaterThan(450);
      expect(straight).toBeLessThan(500);
    });
  });
});
