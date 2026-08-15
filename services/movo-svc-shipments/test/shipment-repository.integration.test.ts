import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository, ShipmentNotFoundError } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { InvalidShipmentTransitionError } from "../src/domain/shipment-state-machine";

describe("shipment-repository (Postgres)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;

  const baseInput: CreateShipmentInput = {
    senderId: randomUUID(),
    receiverId: randomUUID(),
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: "Caja con libros",
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
    repo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // CASCADE también vacía shipment_events/shipment_photos (FK a shipments.shipments).
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  describe("create", () => {
    it("crea el envío en el estado inicial y registra el primer evento", async () => {
      const shipment = await repo.create(baseInput);

      expect(shipment.id).toBeTruthy();
      expect(shipment.status).toBe(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);
      expect(shipment.carrierId).toBeNull();
      expect(shipment.suggestedPriceArs).toBe(4500);

      const events = await repo.listEvents(shipment.id);
      expect(events).toHaveLength(1);
      expect(events[0].fromStatus).toBeNull();
      expect(events[0].toStatus).toBe(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);
      expect(events[0].actorId).toBe(baseInput.senderId);
    });
  });

  describe("findById", () => {
    it("encuentra el envío por id", async () => {
      const created = await repo.create(baseInput);
      const found = await repo.findById(created.id);
      expect(found?.id).toBe(created.id);
    });

    it("devuelve null si no existe", async () => {
      expect(await repo.findById("00000000-0000-0000-0000-000000000000")).toBeNull();
    });
  });

  describe("updateStatus", () => {
    it("aplica una transición válida, persiste el nuevo estado y loguea el evento", async () => {
      const created = await repo.create(baseInput);
      const actorId = randomUUID();

      const updated = await repo.updateStatus(created.id, ShipmentStatus.PUBLISHED, actorId, "receptor confirmó");

      expect(updated.status).toBe(ShipmentStatus.PUBLISHED);
      expect(updated.lastStatusChangedAt).not.toBeNull();

      const events = await repo.listEvents(created.id);
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
        toStatus: ShipmentStatus.PUBLISHED,
        actorId,
        reason: "receptor confirmó",
      });
    });

    it("setea deliveredAt al transicionar a delivered", async () => {
      const created = await repo.create(baseInput);
      await repo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
      await repo.updateStatus(created.id, ShipmentStatus.ASSIGNMENT_PENDING, null);
      await repo.updateStatus(created.id, ShipmentStatus.ASSIGNED, null);
      const delivered = await repo.updateStatus(created.id, ShipmentStatus.IN_TRANSIT, null);
      expect(delivered.deliveredAt).toBeNull();

      const finalShipment = await repo.updateStatus(created.id, ShipmentStatus.DELIVERED, null);
      expect(finalShipment.deliveredAt).not.toBeNull();
    });

    it("rechaza una transición inválida con InvalidShipmentTransitionError y no persiste nada", async () => {
      const created = await repo.create(baseInput);

      await expect(repo.updateStatus(created.id, ShipmentStatus.DELIVERED, null)).rejects.toThrow(
        InvalidShipmentTransitionError,
      );

      const reloaded = await repo.findById(created.id);
      expect(reloaded?.status).toBe(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);

      const events = await repo.listEvents(created.id);
      expect(events).toHaveLength(1);
    });

    it("lanza ShipmentNotFoundError si el id no existe", async () => {
      await expect(
        repo.updateStatus("00000000-0000-0000-0000-000000000000", ShipmentStatus.PUBLISHED, null),
      ).rejects.toThrow(ShipmentNotFoundError);
    });
  });

  describe("addPhoto / listPhotos", () => {
    it("agrega y lista fotos por etapa", async () => {
      const created = await repo.create(baseInput);

      await repo.addPhoto(created.id, PhotoStage.creation, "shipments/foo/creation-1.jpg");
      await repo.addPhoto(created.id, PhotoStage.pickup, "shipments/foo/pickup-1.jpg");

      const photos = await repo.listPhotos(created.id);
      expect(photos).toHaveLength(2);
      expect(photos.map((p) => p.stage).sort()).toEqual([PhotoStage.creation, PhotoStage.pickup].sort());
      expect(photos.every((p) => p.s3Key.startsWith("shipments/"))).toBe(true);
    });

    it("devuelve una lista vacía si el envío no tiene fotos", async () => {
      const created = await repo.create(baseInput);
      expect(await repo.listPhotos(created.id)).toEqual([]);
    });
  });
});
