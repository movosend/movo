import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import {
  createShipmentRepository,
  ShipmentRepository,
  ShipmentNotFoundError,
  ShipmentConcurrentModificationError,
} from "../src/repositories/shipment-repository";
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

    it("persiste un evento con actorId null y el reason esperado al cancelar por expiración de plazo", async () => {
      const created = await repo.create(baseInput);
      const reason = "El receptor no confirmó dentro del plazo";

      const updated = await repo.updateStatus(created.id, ShipmentStatus.CANCELLED, null, reason);

      expect(updated.status).toBe(ShipmentStatus.CANCELLED);

      const events = await repo.listEvents(created.id);
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
        toStatus: ShipmentStatus.CANCELLED,
        actorId: null,
        reason,
      });
    });

    it("MOVO-118: dos transiciones concurrentes desde el mismo status resuelven por compare-and-swap, sin pisarse", async () => {
      const created = await repo.create(baseInput);
      await addTwoCreationPhotos(created.id);
      await repo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);

      // Escenario del ticket: transportista acepta oferta (-> assignment_pending) a la
      // vez que el emisor cancela (-> cancelled), ambas transiciones estructuralmente
      // válidas desde `published`. Sin el compare-and-swap, la segunda en escribir
      // pisaría a la primera sin revalidar contra el status ya cambiado.
      const results = await Promise.allSettled([
        repo.updateStatus(created.id, ShipmentStatus.ASSIGNMENT_PENDING, randomUUID(), "transportista acepta"),
        repo.updateStatus(created.id, ShipmentStatus.CANCELLED, randomUUID(), "emisor cancela"),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ShipmentConcurrentModificationError);

      const winningStatus = (fulfilled[0] as PromiseFulfilledResult<{ status: ShipmentStatus }>).value.status;
      expect([ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.CANCELLED]).toContain(winningStatus);

      // El status persistido es el de la transición ganadora — nunca queda en un
      // estado intermedio ni el de la que perdió la carrera.
      const reloaded = await repo.findById(created.id);
      expect(reloaded?.status).toBe(winningStatus);

      // Solo la transición ganadora dejó evento (inicial + published + la ganadora) —
      // la perdedora no persistió nada, ni siquiera un evento "fantasma".
      const events = await repo.listEvents(created.id);
      expect(events).toHaveLength(3);
      expect(events[2].toStatus).toBe(winningStatus);
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

  describe("findExpiredAwaitingConfirmation", () => {
    it("encuentra envíos awaiting_receiver_confirmation con deadline vencida y los ordena ascendentemente", async () => {
      const now = new Date();
      const past1 = new Date(now.getTime() - 60_000);
      const past2 = new Date(now.getTime() - 120_000);
      const future = new Date(now.getTime() + 60_000);

      const expiredOlder = await repo.create({ ...baseInput, receiverConfirmationDeadline: past2 });
      const expiredNewer = await repo.create({ ...baseInput, receiverConfirmationDeadline: past1 });
      // Futuro: no debe aparecer
      await repo.create({ ...baseInput, receiverConfirmationDeadline: future });
      // Sin deadline (NULL): no debe aparecer
      await repo.create(baseInput);

      const result = await repo.findExpiredAwaitingConfirmation(now, 10);

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual([expiredOlder.id, expiredNewer.id]);
    });

    it("ignora envíos que ya no están en awaiting_receiver_confirmation aunque su deadline esté vencida", async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 60_000);

      const publishedShipment = await repo.create({ ...baseInput, receiverConfirmationDeadline: past });
      await addTwoCreationPhotos(publishedShipment.id);
      await repo.updateStatus(publishedShipment.id, ShipmentStatus.PUBLISHED, randomUUID());

      const rejectedShipment = await repo.create({ ...baseInput, receiverConfirmationDeadline: past });
      await repo.updateStatus(rejectedShipment.id, ShipmentStatus.REJECTED_BY_RECEIVER, randomUUID(), "rechazado");

      const result = await repo.findExpiredAwaitingConfirmation(now, 10);
      expect(result).toEqual([]);
    });

    it("respeta el límite de elementos (limit)", async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 60_000);

      await repo.create({ ...baseInput, receiverConfirmationDeadline: new Date(past.getTime() - 2000) });
      await repo.create({ ...baseInput, receiverConfirmationDeadline: new Date(past.getTime() - 1000) });

      const result = await repo.findExpiredAwaitingConfirmation(now, 1);
      expect(result).toHaveLength(1);
    });
  });

  describe("listAvailable (MOVO-142)", () => {
    // Mismo par pickup/delivery de baseInput -- ~1.04km entre sí (comentario de
    // MOVO-126 en shipments.service.ts).
    const originLat = -31.4201;
    const originLng = -64.1888;
    const destinationLat = -31.4135;
    const destinationLng = -64.1811;
    const KM_PER_DEGREE_LAT = 111.32;

    async function createPublished(overrides: Partial<CreateShipmentInput> = {}) {
      const shipment = await repo.create({ ...baseInput, ...overrides });
      await addTwoCreationPhotos(shipment.id);
      return repo.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, shipment.senderId);
    }

    it("solo devuelve envíos published", async () => {
      const published = await createPublished({
        pickupLat: originLat,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });
      const draft = await repo.create({
        ...baseInput,
        pickupLat: originLat,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });

      const { items } = await repo.listAvailable({
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        radiusKm: 5,
        excludeUserId: randomUUID(),
        page: 1,
        limit: 20,
      });

      expect(items.map((i) => i.id)).toEqual([published.id]);
      expect(items.map((i) => i.id)).not.toContain(draft.id);
    });

    it("excluye los envíos propios del caller (sender o receiver)", async () => {
      const callerId = randomUUID();
      const ownAsSender = await createPublished({
        senderId: callerId,
        pickupLat: originLat,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });
      const ownAsReceiver = await createPublished({
        receiverId: callerId,
        pickupLat: originLat,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });
      const foreign = await createPublished({
        pickupLat: originLat,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });

      const { items } = await repo.listAvailable({
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        radiusKm: 5,
        excludeUserId: callerId,
        page: 1,
        limit: 20,
      });

      expect(items.map((i) => i.id)).toEqual([foreign.id]);
      expect(items.map((i) => i.id)).not.toContain(ownAsSender.id);
      expect(items.map((i) => i.id)).not.toContain(ownAsReceiver.id);
    });

    it("AND real: pickup cerca del origen pero delivery lejos del destino no aparece (y viceversa)", async () => {
      const farLat = originLat - 0.5; // ~55km, bien fuera de cualquier radio razonable
      const matches = await createPublished({
        pickupLat: originLat,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });
      const pickupFar = await createPublished({
        pickupLat: farLat,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });
      const deliveryFar = await createPublished({
        pickupLat: originLat,
        pickupLng: originLng,
        deliveryLat: farLat,
        deliveryLng: destinationLng,
      });

      const { items } = await repo.listAvailable({
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        radiusKm: 5,
        excludeUserId: randomUUID(),
        page: 1,
        limit: 20,
      });

      const ids = items.map((i) => i.id);
      expect(ids).toEqual([matches.id]);
      expect(ids).not.toContain(pickupFar.id);
      expect(ids).not.toContain(deliveryFar.id);
    });

    it("radio: pickup justo dentro del radio aparece, justo fuera no", async () => {
      const radiusKm = 5;
      const insideLat = originLat - 4.5 / KM_PER_DEGREE_LAT; // ~4.5km
      const outsideLat = originLat - 5.5 / KM_PER_DEGREE_LAT; // ~5.5km
      const inside = await createPublished({
        pickupLat: insideLat,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });
      const outside = await createPublished({
        pickupLat: outsideLat,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });

      const { items } = await repo.listAvailable({
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        radiusKm,
        excludeUserId: randomUUID(),
        page: 1,
        limit: 20,
      });

      const ids = items.map((i) => i.id);
      expect(ids).toContain(inside.id);
      expect(ids).not.toContain(outside.id);
    });

    it("ordena por distanceKm ascendente (suma de las dos distancias parciales) -- urgent no altera el orden", async () => {
      const far = await createPublished({
        urgent: true, // el más urgente, pero también el más lejos -- no tiene que salir primero
        pickupLat: originLat - 4 / KM_PER_DEGREE_LAT,
        pickupLng: originLng,
        deliveryLat: destinationLat - 4 / KM_PER_DEGREE_LAT,
        deliveryLng: destinationLng,
      });
      const near = await createPublished({
        pickupLat: originLat,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });
      const middle = await createPublished({
        pickupLat: originLat - 2 / KM_PER_DEGREE_LAT,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });

      const { items } = await repo.listAvailable({
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        radiusKm: 10,
        excludeUserId: randomUUID(),
        page: 1,
        limit: 20,
      });

      expect(items.map((i) => i.id)).toEqual([near.id, middle.id, far.id]);
      expect(items[0].distanceKm).toBeLessThan(items[1].distanceKm);
      expect(items[1].distanceKm).toBeLessThan(items[2].distanceKm);
    });

    it("maxDistanceKm (opcional) tapea la distancia PROPIA retiro→entrega del envío, sin relación con el trayecto del caller", async () => {
      // Origen y destino separados ~15km -- un envío puede tener pickup cerca del
      // origen y delivery cerca del destino (AND satisfecho) con un tramo propio
      // corto o largo según dónde caiga cada extremo.
      const farLat = originLat - 15 / KM_PER_DEGREE_LAT;
      const shortLeg = await createPublished({
        pickupLat: originLat,
        pickupLng: originLng,
        deliveryLat: originLat, // mismo punto que el pickup -- tramo propio ~0km
        deliveryLng: originLng,
      });
      const longLeg = await createPublished({
        pickupLat: originLat,
        pickupLng: originLng,
        deliveryLat: farLat, // ~15km del pickup
        deliveryLng: originLng,
      });

      const withCap = await repo.listAvailable({
        originLat,
        originLng,
        destinationLat: farLat,
        destinationLng: originLng,
        radiusKm: 20,
        maxDistanceKm: 5,
        excludeUserId: randomUUID(),
        page: 1,
        limit: 20,
      });
      expect(withCap.items.map((i) => i.id)).toEqual([shortLeg.id]);

      const withoutCap = await repo.listAvailable({
        originLat,
        originLng,
        destinationLat: farLat,
        destinationLng: originLng,
        radiusKm: 20,
        excludeUserId: randomUUID(),
        page: 1,
        limit: 20,
      });
      expect(withoutCap.items.map((i) => i.id).sort()).toEqual([shortLeg.id, longLeg.id].sort());
    });

    it("pagina con el mismo contrato {items, page, limit, total} que listByUser", async () => {
      const a = await createPublished({
        pickupLat: originLat,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });
      const b = await createPublished({
        pickupLat: originLat - 1 / KM_PER_DEGREE_LAT,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });
      const c = await createPublished({
        pickupLat: originLat - 2 / KM_PER_DEGREE_LAT,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });

      const page1 = await repo.listAvailable({
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        radiusKm: 10,
        excludeUserId: randomUUID(),
        page: 1,
        limit: 2,
      });
      expect(page1.items.map((i) => i.id)).toEqual([a.id, b.id]);
      expect(page1.total).toBe(3);

      const page2 = await repo.listAvailable({
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        radiusKm: 10,
        excludeUserId: randomUUID(),
        page: 2,
        limit: 2,
      });
      expect(page2.items.map((i) => i.id)).toEqual([c.id]);
      expect(page2.total).toBe(3);
    });

    it("devuelve number (no string/bigint) en los campos numéricos -- trampa de $queryRaw sobre Decimal/COUNT", async () => {
      await createPublished({
        pickupLat: originLat,
        pickupLng: originLng,
        deliveryLat: destinationLat,
        deliveryLng: destinationLng,
      });

      const { items, total } = await repo.listAvailable({
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        radiusKm: 5,
        excludeUserId: randomUUID(),
        page: 1,
        limit: 20,
      });

      expect(typeof total).toBe("number");
      expect(typeof items[0].distanceKm).toBe("number");
      expect(typeof items[0].pickupDistanceKm).toBe("number");
      expect(typeof items[0].deliveryDistanceKm).toBe("number");
      expect(typeof items[0].weightKg).toBe("number");
      expect(typeof items[0].suggestedPriceArs).toBe("number");
    });
  });
});
