import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";

describe("GET /shipments/mine (Postgres)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;
  const userA = randomUUID();
  const userB = randomUUID();
  const otherA = randomUUID();
  const otherB = randomUUID();

  function inputFor(senderId: string, receiverId: string): CreateShipmentInput {
    return {
      senderId,
      receiverId,
      packageType: PackageType.standard_package,
      weightKg: 1,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupLat: -31.4201,
      pickupLng: -64.1888,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: -31.4135,
      deliveryLng: -64.1811,
      pickupDate: new Date("2030-01-01T00:00:00.000Z"),
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 1000,
    };
  }

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

  it("lista solo los envíos donde el usuario participa como emisor o receptor", async () => {
    const asSender = await repo.create(inputFor(userA, otherA));
    const asReceiver = await repo.create(inputFor(otherB, userA));
    await repo.create(inputFor(userB, otherB)); // ajeno a userA, no debe aparecer

    const response = await app.inject({
      method: "GET",
      url: "/shipments/mine",
      headers: { "x-user-id": userA },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(2);
    const ids = body.items.map((s: { id: string }) => s.id);
    expect(ids).toContain(asSender.id);
    expect(ids).toContain(asReceiver.id);
  });

  it("pagina correctamente", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create(inputFor(userA, otherA));
    }

    const page1 = await app.inject({
      method: "GET",
      url: "/shipments/mine?page=1&limit=2",
      headers: { "x-user-id": userA },
    });
    const page2 = await app.inject({
      method: "GET",
      url: "/shipments/mine?page=2&limit=2",
      headers: { "x-user-id": userA },
    });

    expect(page1.json().items).toHaveLength(2);
    expect(page2.json().items).toHaveLength(2);
    expect(page1.json().total).toBe(5);
    const page1Ids = page1.json().items.map((s: { id: string }) => s.id);
    const page2Ids = page2.json().items.map((s: { id: string }) => s.id);
    expect(page1Ids).not.toEqual(page2Ids);
  });

  it("responde 401 sin x-user-id", async () => {
    const response = await app.inject({ method: "GET", url: "/shipments/mine" });
    expect(response.statusCode).toBe(401);
  });
});
