import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";

describe("GET /shipments/:id (Postgres)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;
  const senderId = randomUUID();
  const receiverId = randomUUID();
  // MOVO-142 (AC8): perfiles fijos registrados en el fake UsersClient de todo el
  // archivo (buildApp se instancia una sola vez en beforeAll) -- un carrier verificado
  // y uno sin verificar, reusados en los tests de apertura de descubrimiento.
  const verifiedCarrierId = randomUUID();
  const unverifiedCarrierId = randomUUID();
  // MOVO-180 (adelantado): un segundo transportista verificado para ofertar sin ser
  // el mismo que después consulta el agregado de "ofertas actuales".
  const otherVerifiedCarrierId = randomUUID();

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

    app = buildApp({
      usersClient: createFakeUsersClient({
        [verifiedCarrierId]: fakePublicProfile({ id: verifiedCarrierId, isVerified: true }),
        [unverifiedCarrierId]: fakePublicProfile({ id: unverifiedCarrierId, isVerified: false }),
        [otherVerifiedCarrierId]: fakePublicProfile({ id: otherVerifiedCarrierId, isVerified: true }),
      }),
    });
    await app.ready();
    repo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  /** AC6 de MOVO-81 -- precondición para publicar, no forma parte del gate bajo
   * prueba acá (mismo criterio que shipment-repository.integration.test.ts). */
  async function addTwoCreationPhotos(shipmentId: string): Promise<void> {
    await repo.addPhoto(shipmentId, PhotoStage.creation, `shipments/${shipmentId}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(shipmentId, PhotoStage.creation, `shipments/${shipmentId}/creation/${randomUUID()}.jpg`);
  }

  it("el emisor puede ver el detalle", async () => {
    const shipment = await repo.create(baseInput);
    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipment.id}`,
      headers: { "x-user-id": senderId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(shipment.id);
  });

  it("el receptor puede ver el detalle", async () => {
    const shipment = await repo.create(baseInput);
    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipment.id}`,
      headers: { "x-user-id": receiverId },
    });
    expect(response.statusCode).toBe(200);
  });

  it("un admin ajeno al envío puede ver el detalle", async () => {
    const shipment = await repo.create(baseInput);
    const adminId = randomUUID();
    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipment.id}`,
      headers: { "x-user-id": adminId, "x-user-roles": "admin" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("un tercero recibe 403, no 404", async () => {
    const shipment = await repo.create(baseInput);
    const strangerId = randomUUID();
    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipment.id}`,
      headers: { "x-user-id": strangerId },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
  });

  it("responde 404 para un id inexistente", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/shipments/${randomUUID()}`,
      headers: { "x-user-id": senderId },
    });
    expect(response.statusCode).toBe(404);
  });

  // MOVO-142 (AC8): apertura de visibilidad para el transportista.
  describe("apertura para el transportista (MOVO-142)", () => {
    it("un transportista verificado ve el detalle de un published ajeno", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);
      await repo.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, receiverId);

      const response = await app.inject({
        method: "GET",
        url: `/shipments/${shipment.id}`,
        headers: { "x-user-id": verifiedCarrierId, "x-user-roles": "carrier" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(shipment.id);
      // Sin ofertas todavía -- MOVO-180 (adelantado).
      expect(response.json().offersSummary).toBeNull();
    });

    it("MOVO-180: expone el agregado de ofertas vigentes (conteo + neto mínimo, sin identidad)", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);
      await repo.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, receiverId);

      await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/offers`,
        headers: { "x-user-id": otherVerifiedCarrierId, "x-user-roles": "carrier" },
        payload: { priceOfferedArs: 2000, offeredDate: "2030-01-01" },
      });

      const response = await app.inject({
        method: "GET",
        url: `/shipments/${shipment.id}`,
        headers: { "x-user-id": verifiedCarrierId, "x-user-roles": "carrier" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().offersSummary).toEqual({ count: 1, minPriceNetArs: 2000 });
      // El agregado nunca expone quién ofertó.
      expect(JSON.stringify(response.json().offersSummary)).not.toContain(otherVerifiedCarrierId);
    });

    it("un transportista verificado NO ve un envío assignment_pending ajeno (403 se mantiene)", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);
      await repo.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, receiverId);
      await repo.updateStatus(shipment.id, ShipmentStatus.ASSIGNMENT_PENDING, randomUUID());

      const response = await app.inject({
        method: "GET",
        url: `/shipments/${shipment.id}`,
        headers: { "x-user-id": verifiedCarrierId, "x-user-roles": "carrier" },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("el carrierId ya asignado ve su propio envío en cualquier estado no-published", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);
      await repo.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, receiverId);
      await repo.updateStatus(shipment.id, ShipmentStatus.ASSIGNMENT_PENDING, verifiedCarrierId);
      await app.db.shipment.update({ where: { id: shipment.id }, data: { carrierId: verifiedCarrierId } });
      await repo.updateStatus(shipment.id, ShipmentStatus.ASSIGNED, verifiedCarrierId);

      const response = await app.inject({
        method: "GET",
        url: `/shipments/${shipment.id}`,
        headers: { "x-user-id": verifiedCarrierId, "x-user-roles": "carrier" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(shipment.id);
    });

    it("un transportista sin verificar recibe 403 CARRIER_NOT_VERIFIED (no AUTH_FORBIDDEN) sobre un published ajeno", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);
      await repo.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, receiverId);

      const response = await app.inject({
        method: "GET",
        url: `/shipments/${shipment.id}`,
        headers: { "x-user-id": unverifiedCarrierId, "x-user-roles": "carrier" },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("CARRIER_NOT_VERIFIED");
    });

    it("un usuario sin rol carrier recibe 403 CARRIER_NOT_VERIFIED sobre un published ajeno", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);
      await repo.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, receiverId);

      const response = await app.inject({
        method: "GET",
        url: `/shipments/${shipment.id}`,
        headers: { "x-user-id": verifiedCarrierId },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("CARRIER_NOT_VERIFIED");
    });
  });
});
