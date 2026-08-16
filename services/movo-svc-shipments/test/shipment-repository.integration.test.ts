import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository, ShipmentNotFoundError } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { InvalidShipmentTransitionError, InsufficientCreationPhotosError } from "../src/domain/shipment-state-machine";

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

  /** AC6 de MOVO-81: precondición para publicar, no forma parte del grafo de
   * transiciones -- se cumple acá para no acoplar los tests de `updateStatus` que no
   * son sobre el gate de fotos a esa precondición. */
  async function addTwoCreationPhotos(shipmentId: string): Promise<void> {
    await repo.addPhoto(shipmentId, PhotoStage.creation, `shipments/${shipmentId}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(shipmentId, PhotoStage.creation, `shipments/${shipmentId}/creation/${randomUUID()}.jpg`);
  }

  describe("updateStatus", () => {
    it("aplica una transición válida, persiste el nuevo estado y loguea el evento", async () => {
      const created = await repo.create(baseInput);
      await addTwoCreationPhotos(created.id);
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
      await addTwoCreationPhotos(created.id);
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

    it("rechaza publicar sin ninguna foto de creation (AC6 de MOVO-81)", async () => {
      const created = await repo.create(baseInput);

      await expect(repo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null)).rejects.toThrow(
        InsufficientCreationPhotosError,
      );

      const reloaded = await repo.findById(created.id);
      expect(reloaded?.status).toBe(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);
    });

    it("rechaza publicar con una sola foto de creation", async () => {
      const created = await repo.create(baseInput);
      await repo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);

      await expect(repo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null)).rejects.toThrow(
        InsufficientCreationPhotosError,
      );
    });

    it("fotos de otra etapa (pickup/delivery) no cuentan para el mínimo de creation", async () => {
      const created = await repo.create(baseInput);
      await repo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
      await repo.addPhoto(created.id, PhotoStage.pickup, `shipments/${created.id}/pickup/${randomUUID()}.jpg`);
      await repo.addPhoto(created.id, PhotoStage.pickup, `shipments/${created.id}/pickup/${randomUUID()}.jpg`);

      await expect(repo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null)).rejects.toThrow(
        InsufficientCreationPhotosError,
      );
    });

    it("permite publicar con 2 o más fotos de creation", async () => {
      const created = await repo.create(baseInput);
      await addTwoCreationPhotos(created.id);

      const updated = await repo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
      expect(updated.status).toBe(ShipmentStatus.PUBLISHED);
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

  describe("listByUser", () => {
    it("incluye envíos donde el usuario es sender y donde es receiver, ordenados por más reciente", async () => {
      const userId = randomUUID();
      const asSender = await repo.create({ ...baseInput, senderId: userId, receiverId: randomUUID() });
      const asReceiver = await repo.create({ ...baseInput, senderId: randomUUID(), receiverId: userId });
      await repo.create(baseInput); // ajeno, no debe aparecer

      const { items, total } = await repo.listByUser(userId, 1, 20);

      expect(total).toBe(2);
      expect(items.map((s) => s.id)).toEqual([asReceiver.id, asSender.id]);
    });

    it("pagina con skip/take", async () => {
      const userId = randomUUID();
      for (let i = 0; i < 3; i++) {
        await repo.create({ ...baseInput, senderId: userId });
      }

      const page1 = await repo.listByUser(userId, 1, 2);
      const page2 = await repo.listByUser(userId, 2, 2);

      expect(page1.items).toHaveLength(2);
      expect(page2.items).toHaveLength(1);
      expect(page1.total).toBe(3);
      expect(page2.total).toBe(3);
    });

    it("devuelve vacío si el usuario no participa en ningún envío", async () => {
      await repo.create(baseInput);
      const { items, total } = await repo.listByUser(randomUUID(), 1, 20);
      expect(items).toEqual([]);
      expect(total).toBe(0);
    });
  });
});
