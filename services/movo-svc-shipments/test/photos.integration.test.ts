import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";
import { createMockStorageProvider, MockStorageProvider } from "../src/adapters/mock-storage-provider";

describe("Fotos del paquete (MOVO-81, Postgres)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;
  let storageProvider: MockStorageProvider;
  const senderId = randomUUID();
  const receiverId = randomUUID();

  const baseInput: CreateShipmentInput = {
    senderId,
    receiverId,
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.1811,
    pickupDate: new Date("2030-01-01T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 4500,
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    storageProvider = createMockStorageProvider();
    app = buildApp({ usersClient: createFakeUsersClient({}), storageProvider });
    await app.ready();
    repo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  describe("POST /shipments/:id/photos/presign", () => {
    it("el emisor obtiene una presigned URL de subida", async () => {
      const shipment = await repo.create(baseInput);
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/photos/presign`,
        headers: { "x-user-id": senderId },
        payload: { stage: "creation", contentType: "image/jpeg", contentLength: 500_000 },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.uploadUrl).toBeTruthy();
      expect(body.s3Key.startsWith(`shipments/${shipment.id}/creation/`)).toBe(true);
      expect(body.s3Key.endsWith(".jpg")).toBe(true);
      expect(body.expiresIn).toBeGreaterThan(0);
    });

    it("un tercero (ni emisor ni receptor) recibe 403", async () => {
      const shipment = await repo.create(baseInput);
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/photos/presign`,
        headers: { "x-user-id": receiverId },
        payload: { stage: "creation", contentType: "image/jpeg", contentLength: 500_000 },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("rechaza un content-type no permitido", async () => {
      const shipment = await repo.create(baseInput);
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/photos/presign`,
        headers: { "x-user-id": senderId },
        payload: { stage: "creation", contentType: "image/png", contentLength: 500_000 },
      });

      expect(response.statusCode).toBe(400);
    });

    it("rechaza un tamaño mayor al máximo permitido (2 MB)", async () => {
      const shipment = await repo.create(baseInput);
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/photos/presign`,
        headers: { "x-user-id": senderId },
        payload: { stage: "creation", contentType: "image/jpeg", contentLength: 3 * 1024 * 1024 },
      });

      expect(response.statusCode).toBe(400);
    });

    it("responde 404 para un envío inexistente", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${randomUUID()}/photos/presign`,
        headers: { "x-user-id": senderId },
        payload: { stage: "creation", contentType: "image/jpeg", contentLength: 500_000 },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /shipments/:id/photos/confirm", () => {
    it("rechaza confirmar un objeto que nunca se subió (422)", async () => {
      const shipment = await repo.create(baseInput);
      const presign = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/photos/presign`,
        headers: { "x-user-id": senderId },
        payload: { stage: "creation", contentType: "image/jpeg", contentLength: 500_000 },
      });
      const { s3Key } = presign.json();

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/photos/confirm`,
        headers: { "x-user-id": senderId },
        payload: { s3Key, stage: "creation" },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("PHOTO_OBJECT_NOT_FOUND");
    });

    it("rechaza un s3Key que no pertenece al envío/etapa (403)", async () => {
      const shipment = await repo.create(baseInput);
      const foreignKey = `shipments/${randomUUID()}/creation/${randomUUID()}.jpg`;

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/photos/confirm`,
        headers: { "x-user-id": senderId },
        payload: { s3Key: foreignKey, stage: "creation" },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("PHOTO_FORBIDDEN_KEY");
    });

    it("confirma y registra la foto una vez subida", async () => {
      const shipment = await repo.create(baseInput);
      const presign = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/photos/presign`,
        headers: { "x-user-id": senderId },
        payload: { stage: "creation", contentType: "image/jpeg", contentLength: 500_000 },
      });
      const { s3Key } = presign.json();
      storageProvider.__simulateUpload(s3Key, { contentType: "image/jpeg", contentLength: 500_000 });

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/photos/confirm`,
        headers: { "x-user-id": senderId },
        payload: { s3Key, stage: "creation" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().stage).toBe("creation");

      const photos = await repo.listPhotos(shipment.id);
      expect(photos).toHaveLength(1);
      expect(photos[0].s3Key).toBe(s3Key);
    });

    it("confirmar el mismo s3Key dos veces es idempotente (no duplica la fila)", async () => {
      // Fix de review (PR #76, tmvergara): sin esto, un reintento del cliente ante un
      // timeout de red creaba dos filas para la misma foto y el gate de AC6
      // (MIN_CREATION_PHOTOS_TO_PUBLISH) contaba evidencia duplicada como si fueran dos
      // fotos reales distintas.
      const shipment = await repo.create(baseInput);
      const presign = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/photos/presign`,
        headers: { "x-user-id": senderId },
        payload: { stage: "creation", contentType: "image/jpeg", contentLength: 500_000 },
      });
      const { s3Key } = presign.json();
      storageProvider.__simulateUpload(s3Key, { contentType: "image/jpeg", contentLength: 500_000 });

      const first = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/photos/confirm`,
        headers: { "x-user-id": senderId },
        payload: { s3Key, stage: "creation" },
      });
      const second = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/photos/confirm`,
        headers: { "x-user-id": senderId },
        payload: { s3Key, stage: "creation" },
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(first.json().id);

      const photos = await repo.listPhotos(shipment.id);
      expect(photos).toHaveLength(1);
    });
  });

  describe("GET /shipments/:id/photos", () => {
    async function confirmOnePhoto(shipmentId: string) {
      const presign = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/photos/presign`,
        headers: { "x-user-id": senderId },
        payload: { stage: "creation", contentType: "image/jpeg", contentLength: 500_000 },
      });
      const { s3Key } = presign.json();
      storageProvider.__simulateUpload(s3Key, { contentType: "image/jpeg", contentLength: 500_000 });
      await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/photos/confirm`,
        headers: { "x-user-id": senderId },
        payload: { s3Key, stage: "creation" },
      });
    }

    it("el emisor, el receptor y un admin pueden listar las fotos con URLs de lectura", async () => {
      const shipment = await repo.create(baseInput);
      await confirmOnePhoto(shipment.id);

      for (const headers of [
        { "x-user-id": senderId },
        { "x-user-id": receiverId },
        { "x-user-id": randomUUID(), "x-user-roles": "admin" },
      ]) {
        const response = await app.inject({ method: "GET", url: `/shipments/${shipment.id}/photos`, headers });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body).toHaveLength(1);
        expect(body[0].url).toBeTruthy();
        expect(body[0].stage).toBe("creation");
      }
    });

    it("un tercero recibe 403", async () => {
      const shipment = await repo.create(baseInput);
      await confirmOnePhoto(shipment.id);

      const response = await app.inject({
        method: "GET",
        url: `/shipments/${shipment.id}/photos`,
        headers: { "x-user-id": randomUUID() },
      });

      expect(response.statusCode).toBe(403);
    });

    it("responde 404 para un envío inexistente", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/shipments/${randomUUID()}/photos`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
