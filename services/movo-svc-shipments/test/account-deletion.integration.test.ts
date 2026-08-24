import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";

describe("GET /internal/account-deletion/users/:userId/active-shipments (MOVO-134)", () => {
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
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  async function forceStatus(shipmentId: string, status: ShipmentStatus, carrierId?: string): Promise<void> {
    await app.db.shipment.update({
      where: { id: shipmentId },
      data: { status, ...(carrierId ? { carrierId } : {}) },
    });
  }

  async function query(userId: string) {
    const response = await app.inject({
      method: "GET",
      url: `/internal/account-deletion/users/${userId}/active-shipments`,
    });
    return { response, body: JSON.parse(response.body) as { hasActiveDispute: boolean; hasActiveShipments: boolean } };
  }

  it("usuario sin ningún envío -> ambos en false", async () => {
    const { response, body } = await query(randomUUID());
    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ hasActiveDispute: false, hasActiveShipments: false });
  });

  it("envío en un estado no terminal como emisor -> hasActiveShipments true, hasActiveDispute false", async () => {
    const senderId = randomUUID();
    const created = await repo.create({ ...baseInput, senderId });
    await forceStatus(created.id, ShipmentStatus.PUBLISHED);

    const { body } = await query(senderId);
    expect(body).toEqual({ hasActiveDispute: false, hasActiveShipments: true });
  });

  it("envío en un estado no terminal como receptor -> cuenta igual", async () => {
    const receiverId = randomUUID();
    const created = await repo.create({ ...baseInput, receiverId });
    await forceStatus(created.id, ShipmentStatus.ASSIGNMENT_PENDING);

    const { body } = await query(receiverId);
    expect(body).toEqual({ hasActiveDispute: false, hasActiveShipments: true });
  });

  it("envío en un estado no terminal como transportista (carrierId) -> cuenta igual", async () => {
    const carrierId = randomUUID();
    const created = await repo.create(baseInput);
    await forceStatus(created.id, ShipmentStatus.ASSIGNED, carrierId);

    const { body } = await query(carrierId);
    expect(body).toEqual({ hasActiveDispute: false, hasActiveShipments: true });
  });

  it("envío in_transit -> cuenta como hasActiveShipments (sin transición de cancelación, decisión de refinamiento)", async () => {
    const senderId = randomUUID();
    const created = await repo.create({ ...baseInput, senderId });
    await forceStatus(created.id, ShipmentStatus.IN_TRANSIT);

    const { body } = await query(senderId);
    expect(body.hasActiveShipments).toBe(true);
    expect(body.hasActiveDispute).toBe(false);
  });

  it("envío disputed -> hasActiveDispute true, no hasActiveShipments", async () => {
    const senderId = randomUUID();
    const created = await repo.create({ ...baseInput, senderId });
    await forceStatus(created.id, ShipmentStatus.DISPUTED);

    const { body } = await query(senderId);
    expect(body).toEqual({ hasActiveDispute: true, hasActiveShipments: false });
  });

  it("un envío disputed y otro activo del mismo usuario -> ambos true", async () => {
    const senderId = randomUUID();
    const disputed = await repo.create({ ...baseInput, senderId });
    await forceStatus(disputed.id, ShipmentStatus.DISPUTED);
    const active = await repo.create({ ...baseInput, senderId });
    await forceStatus(active.id, ShipmentStatus.PUBLISHED);

    const { body } = await query(senderId);
    expect(body).toEqual({ hasActiveDispute: true, hasActiveShipments: true });
  });

  it.each([ShipmentStatus.DELIVERED, ShipmentStatus.REJECTED_BY_RECEIVER, ShipmentStatus.CANCELLED])(
    "envío en estado terminal %s -> no cuenta como activo",
    async (status) => {
      const senderId = randomUUID();
      const created = await repo.create({ ...baseInput, senderId });
      await forceStatus(created.id, status);

      const { body } = await query(senderId);
      expect(body).toEqual({ hasActiveDispute: false, hasActiveShipments: false });
    },
  );

  it("no aparece en la Swagger pública (endpoint interno, schema hide:true)", async () => {
    const swagger = app.swagger() as { paths: Record<string, unknown> };
    expect(swagger.paths["/internal/account-deletion/users/{userId}/active-shipments"]).toBeUndefined();
  });
});
