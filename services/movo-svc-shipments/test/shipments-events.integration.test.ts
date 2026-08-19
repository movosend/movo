import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";

describe("GET /shipments/:id/events (Postgres)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;
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

    app = buildApp({ usersClient: createFakeUsersClient({}) });
    await app.ready();
    repo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  it("el emisor puede ver el historial de eventos ordenados ascendentemente", async () => {
    const shipment = await repo.create(baseInput);

    // Agregamos fotos de creation requeridas para la transición a published
    await repo.addPhoto(shipment.id, PhotoStage.creation, `shipments/${shipment.id}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(shipment.id, PhotoStage.creation, `shipments/${shipment.id}/creation/${randomUUID()}.jpg`);

    await repo.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, receiverId, "Receptor confirmó");

    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipment.id}/events`,
      headers: { "x-user-id": senderId },
    });

    expect(response.statusCode).toBe(200);
    const events = response.json();
    expect(Array.isArray(events)).toBe(true);
    expect(events).toHaveLength(2);

    expect(events[0]).toMatchObject({
      shipmentId: shipment.id,
      fromStatus: null,
      toStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
      actorId: senderId,
      reason: null,
    });
    expect(events[0].createdAt).toBeDefined();

    expect(events[1]).toMatchObject({
      shipmentId: shipment.id,
      fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
      toStatus: ShipmentStatus.PUBLISHED,
      actorId: receiverId,
      reason: "Receptor confirmó",
    });
    expect(events[1].createdAt).toBeDefined();

    expect(new Date(events[0].createdAt).getTime()).toBeLessThanOrEqual(new Date(events[1].createdAt).getTime());
  });

  it("el receptor puede ver el historial de eventos", async () => {
    const shipment = await repo.create(baseInput);
    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipment.id}/events`,
      headers: { "x-user-id": receiverId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });

  it("un admin ajeno al envío puede ver el historial de eventos", async () => {
    const shipment = await repo.create(baseInput);
    const adminId = randomUUID();
    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipment.id}/events`,
      headers: { "x-user-id": adminId, "x-user-roles": "admin" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });

  it("un tercero recibe 403, no 404", async () => {
    const shipment = await repo.create(baseInput);
    const strangerId = randomUUID();
    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipment.id}/events`,
      headers: { "x-user-id": strangerId },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
  });

  it("responde 404 para un id inexistente", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/shipments/${randomUUID()}/events`,
      headers: { "x-user-id": senderId },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });

  it("responde 401 si falta x-user-id", async () => {
    const shipment = await repo.create(baseInput);
    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipment.id}/events`,
    });
    expect(response.statusCode).toBe(401);
  });
});
