import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { OperationsReport, ReportSource, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { SANCTION_WITHDRAWAL_REASON } from "../src/domain/cancellation-cause";
import { PackageType } from "../src/models/shipment";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient } from "./fake-payments-client";
import { createFakePricingClient } from "./fake-pricing-client";
import { createFakePricingLogisticsClient } from "./fake-pricing-logistics-client";

// Mediodía de Argentina (UTC-3) del día pedido.
const noon = (day: string) => new Date(`${day}T15:00:00.000Z`);

const FROM = "2026-10-01";
const TO = "2026-10-02";

interface CancelEvent {
  at: Date;
  fromStatus: ShipmentStatus;
  byAdmin?: "manual" | "forced";
  bySender?: boolean;
  attribution?: "carrier" | "none";
  reason?: string;
}

interface Options {
  pickupCity?: string | null;
  published?: Date;
  completed?: Date;
  cancelled?: CancelEvent;
  demandRatio?: number;
  highDemand?: boolean | null;
  availableCarriers?: number;
}

/** MOVO-35 B1-B3: el reporte de Operación contra Postgres real, con fechas y ciudades fijas. */
describe("reporte de Operación (Postgres) — MOVO-35", () => {
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

  async function shipment(options: Options = {}) {
    const senderId = randomUUID();
    const created = await shipments.create({
      senderId,
      receiverId: randomUUID(),
      packageType: PackageType.standard_package,
      weightKg: 1,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      description: "Caja",
      pickupAddress: "Av. Colón 1234",
      pickupLat: -31.42,
      pickupLng: -64.18,
      pickupCity: options.pickupCity === undefined ? "Córdoba" : options.pickupCity,
      deliveryAddress: "Bv. San Juan 500",
      deliveryLat: -31.41,
      deliveryLng: -64.18,
      deliveryCity: "Córdoba",
      pickupDate: new Date("2031-06-01T00:00:00.000Z"),
      pickupTimeWindowStart: new Date("1970-01-01T14:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T18:00:00.000Z"),
      suggestedPriceArs: 1000,
      calculationMethod: "package_tapered_v3",
      highDemand: options.highDemand === undefined ? false : options.highDemand,
      distanceKm: 100,
      ...(options.demandRatio === undefined
        ? {}
        : {
            quoteBreakdown: {
              distanceKm: 100,
              distanceSource: "haversine_mock",
              fuelArsPerLiter: 1500,
              fuelSource: "config",
              perKmArs: 10,
              base: 500,
              distance: 400,
              weight: 100,
              packageFactor: 1,
              demandRatio: options.demandRatio,
              demandMultiplier: 1,
            },
          }),
      ...(options.availableCarriers === undefined ? {} : { demandPublishedShipments: 3, demandAvailableCarriers: options.availableCarriers }),
    });
    if (options.published) await app.db.shipmentEvent.create({ data: { shipmentId: created.id, toStatus: ShipmentStatus.PUBLISHED, createdAt: options.published } });
    if (options.completed) await app.db.shipmentEvent.create({ data: { shipmentId: created.id, toStatus: ShipmentStatus.COMPLETED, createdAt: options.completed } });
    if (options.cancelled) {
      const { at, fromStatus, byAdmin, bySender, attribution, reason } = options.cancelled;
      await app.db.shipment.update({ where: { id: created.id }, data: { status: ShipmentStatus.CANCELLED } });
      await app.db.shipmentEvent.create({
        data: {
          shipmentId: created.id,
          fromStatus,
          toStatus: ShipmentStatus.CANCELLED,
          createdAt: at,
          actorId: byAdmin ? randomUUID() : bySender ? senderId : null,
          ...(byAdmin ? { kind: byAdmin, actorName: "Admin" } : {}),
          ...(attribution ? { attribution } : {}),
          ...(reason ? { reason } : {}),
        },
      });
    }
    return created.id;
  }

  async function get(query = ""): Promise<ReportSource<OperationsReport>> {
    const response = await app.inject({ method: "GET", url: `/internal/admin/reports/operations?from=${FROM}&to=${TO}${query}` });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it("cuenta publicados, completados y cancelados por su fecha, con el período anterior", async () => {
    await shipment({ published: noon("2026-10-01"), completed: noon("2026-10-02") });
    await shipment({ published: noon("2026-09-30") });
    await shipment({ published: noon("2026-09-30"), cancelled: { at: noon("2026-10-01"), fromStatus: ShipmentStatus.PUBLISHED, bySender: true } });
    // Fuera de las dos ventanas: no entra.
    await shipment({ published: noon("2026-08-01") });

    const report = await get();

    expect(report.kpis.published).toEqual({ value: 1, previous: 2 });
    expect(report.kpis.completed).toEqual({ value: 1, previous: 0 });
    expect(report.kpis.cancelled).toEqual({ value: 1, previous: 0 });
    expect(report.series.published.map((point) => point.value)).toEqual([1, 0]);
  });

  it("atribuye cada cancelación a una sola causa, desde el evento", async () => {
    const at = noon("2026-10-01");
    await shipment({ cancelled: { at, fromStatus: ShipmentStatus.PUBLISHED, bySender: true } });
    await shipment({ cancelled: { at, fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION } });
    await shipment({ cancelled: { at, fromStatus: ShipmentStatus.PUBLISHED } });
    await shipment({ cancelled: { at, fromStatus: ShipmentStatus.ASSIGNED, attribution: "carrier" } });
    await shipment({ cancelled: { at, fromStatus: ShipmentStatus.ASSIGNED, attribution: "none" } });
    await shipment({ cancelled: { at, fromStatus: ShipmentStatus.PUBLISHED, bySender: true, reason: SANCTION_WITHDRAWAL_REASON } });
    await shipment({ cancelled: { at, fromStatus: ShipmentStatus.DISPUTED, byAdmin: "manual" } });
    await shipment({ cancelled: { at, fromStatus: ShipmentStatus.ASSIGNED, byAdmin: "forced" } });

    const report = await get();
    const rows = Object.fromEntries((report.breakdowns.find((row) => row.dimension === "cancelCause")?.rows ?? []).map((row) => [row.key, row.value]));

    expect(rows).toEqual({
      sender: 1,
      receiver: 1,
      expired: 1,
      pickup_missed_carrier: 1,
      pickup_missed_other: 1,
      sanction: 1,
      dispute: 1,
      admin: 1,
      other: 0,
    });
  });

  it("usa la señal de demanda guardada al publicar y filtra por la ciudad del retiro", async () => {
    const published = noon("2026-10-01");
    await shipment({ published, demandRatio: 3, highDemand: true, availableCarriers: 1 });
    await shipment({ published, demandRatio: 1, highDemand: false, availableCarriers: 3 });
    // Cotizado sin conteo: pricing manda 0, no es una medición.
    await shipment({ published, demandRatio: 0, highDemand: false });
    await shipment({ published, pickupCity: "Rosario", demandRatio: 5, highDemand: true, availableCarriers: 0 });
    await shipment({ published, pickupCity: null });

    const all = await get();
    expect(all.kpis.demandRatio.value).toBe(3);
    expect(all.kpis.availableCarriers.value).toBe(1.33);
    expect(all.cities).toEqual([
      { city: "Córdoba", published: 3 },
      { city: "Rosario", published: 1 },
    ]);

    const cordoba = await get(`&city=${encodeURIComponent("Córdoba")}`);
    expect(cordoba.city).toBe("Córdoba");
    expect(cordoba.kpis.published.value).toBe(3);
    expect(cordoba.kpis.demandRatio.value).toBe(2);
    expect(cordoba.kpis.highDemandRate.value).toBe(33.33);
    expect(cordoba.kpis.availableCarriers.value).toBe(2);
    expect(cordoba.cities).toHaveLength(2);
  });

  it("valida el rango y la ciudad", async () => {
    const inverted = await app.inject({ method: "GET", url: `/internal/admin/reports/operations?from=${TO}&to=${FROM}` });
    expect(inverted.statusCode).toBe(400);
    const empty = await app.inject({ method: "GET", url: `/internal/admin/reports/operations?from=${FROM}&to=${TO}&city=` });
    expect(empty.statusCode).toBe(400);
  });
});
