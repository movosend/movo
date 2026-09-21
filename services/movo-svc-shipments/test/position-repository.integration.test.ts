import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus as PrismaShipmentStatus } from "../src/generated/prisma/client";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createPositionRepository, PositionRepository } from "../src/repositories/position-repository";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";

describe("position-repository (Postgres, MOVO-202)", () => {
  let app: FastifyInstance;
  let db: FastifyInstance["db"];
  let shipmentRepo: ShipmentRepository;
  let positionRepo: PositionRepository;

  const baseInput: CreateShipmentInput = {
    senderId: randomUUID(),
    receiverId: randomUUID(),
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: null,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.1811,
    pickupDate: new Date("2026-08-20T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 4500,
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
    db = app.db;
    shipmentRepo = createShipmentRepository(db);
    positionRepo = createPositionRepository(db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  async function forceClosed(
    shipmentId: string,
    status: PrismaShipmentStatus,
    lastStatusChangedAt: Date,
    carrierId?: string
  ): Promise<void> {
    await db.shipment.update({
      where: { id: shipmentId },
      data: { status, lastStatusChangedAt, ...(carrierId ? { carrierId } : {}) },
    });
  }

  describe("create (AC1/AC9)", () => {
    it("persiste lat/lng/accuracyM/capturedAt, con recordedAt propio del servidor", async () => {
      const shipment = await shipmentRepo.create(baseInput);
      const before = new Date();

      const created = await positionRepo.create({
        shipmentId: shipment.id,
        lat: -31.42,
        lng: -64.18,
        accuracyM: 12.5,
        capturedAt: new Date("2026-08-19T23:00:00.000Z"), // encolada offline, anterior a "ahora"
      });

      expect(created.lat).toBe(-31.42);
      expect(created.lng).toBe(-64.18);
      expect(created.accuracyM).toBe(12.5);
      expect(created.capturedAt.toISOString()).toBe("2026-08-19T23:00:00.000Z");
      expect(created.recordedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe("purgeEligibleClosedShipments (AC6)", () => {
    it("borra posiciones de un envío delivered cerrado hace más de retentionDays", async () => {
      const shipment = await shipmentRepo.create(baseInput);
      await positionRepo.create({ shipmentId: shipment.id, lat: 1, lng: 1, accuracyM: 5, capturedAt: new Date() });
      const closedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      await forceClosed(shipment.id, "delivered", closedAt);

      const deleted = await positionRepo.purgeEligibleClosedShipments(new Date(), 30);

      expect(deleted).toBe(1);
      expect(await db.carrierPosition.count({ where: { shipmentId: shipment.id } })).toBe(0);
    });

    it("NO borra un envío cerrado hace menos de retentionDays", async () => {
      const shipment = await shipmentRepo.create(baseInput);
      await positionRepo.create({ shipmentId: shipment.id, lat: 1, lng: 1, accuracyM: 5, capturedAt: new Date() });
      const closedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await forceClosed(shipment.id, "delivered", closedAt);

      const deleted = await positionRepo.purgeEligibleClosedShipments(new Date(), 30);

      expect(deleted).toBe(0);
      expect(await db.carrierPosition.count({ where: { shipmentId: shipment.id } })).toBe(1);
    });

    it("un envío 'disputed' NUNCA es candidato, sin importar cuánto tiempo pasó", async () => {
      const shipment = await shipmentRepo.create(baseInput);
      await positionRepo.create({ shipmentId: shipment.id, lat: 1, lng: 1, accuracyM: 5, capturedAt: new Date() });
      const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      await forceClosed(shipment.id, "disputed", longAgo);

      const deleted = await positionRepo.purgeEligibleClosedShipments(new Date(), 30);

      expect(deleted).toBe(0);
      expect(await db.carrierPosition.count({ where: { shipmentId: shipment.id } })).toBe(1);
    });

    it("un envío que ESTUVO disputed y salió a un estado elegible cuenta desde esa resolución, no desde el cierre original", async () => {
      // Simula: cerró delivered hace 40 días, entró en disputa, se "resolvió" (vía un
      // segundo forceClosed) hace apenas 2 días -- lastStatusChangedAt es lo único que
      // importa, no hay memoria del paso por disputed.
      const shipment = await shipmentRepo.create(baseInput);
      await positionRepo.create({ shipmentId: shipment.id, lat: 1, lng: 1, accuracyM: 5, capturedAt: new Date() });
      await forceClosed(shipment.id, "disputed", new Date(Date.now() - 40 * 24 * 60 * 60 * 1000));
      await forceClosed(shipment.id, "cancelled", new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));

      const deleted = await positionRepo.purgeEligibleClosedShipments(new Date(), 30);

      expect(deleted).toBe(0); // todavía no pasaron los 30 días desde la resolución
    });

    it("cubre delivered/completed/cancelled/rejected_by_receiver, no toca envíos abiertos", async () => {
      const closedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const eligible: PrismaShipmentStatus[] = ["delivered", "completed", "cancelled", "rejected_by_receiver"];
      const shipmentIds: string[] = [];
      for (const status of eligible) {
        const shipment = await shipmentRepo.create(baseInput);
        await positionRepo.create({ shipmentId: shipment.id, lat: 1, lng: 1, accuracyM: 5, capturedAt: new Date() });
        await forceClosed(shipment.id, status, closedAt);
        shipmentIds.push(shipment.id);
      }
      const openShipment = await shipmentRepo.create(baseInput);
      await positionRepo.create({ shipmentId: openShipment.id, lat: 1, lng: 1, accuracyM: 5, capturedAt: new Date() });
      await forceClosed(openShipment.id, "in_transit", closedAt);

      const deleted = await positionRepo.purgeEligibleClosedShipments(new Date(), 30);

      expect(deleted).toBe(4);
      expect(await db.carrierPosition.count({ where: { shipmentId: openShipment.id } })).toBe(1);
    });
  });

  describe("deleteAllForCarrier (AC7)", () => {
    it("borra todas las posiciones de los envíos donde el usuario fue transportista, sin importar estado/retención", async () => {
      const carrierId = randomUUID();
      const shipment = await shipmentRepo.create(baseInput);
      await positionRepo.create({ shipmentId: shipment.id, lat: 1, lng: 1, accuracyM: 5, capturedAt: new Date() });
      await forceClosed(shipment.id, "in_transit", new Date(), carrierId); // ni siquiera cerrado

      const deleted = await positionRepo.deleteAllForCarrier(carrierId);

      expect(deleted).toBe(1);
    });
  });
});
