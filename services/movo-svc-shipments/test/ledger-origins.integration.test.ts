import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createShipmentRepository } from "../src/repositories/shipment-repository";
import { PackageType } from "../src/models/shipment";

describe("POST /internal/ledger-origins", () => {
  let app: FastifyInstance;
  const senderId = randomUUID();
  const receiverId = randomUUID();
  const formerCarrierId = randomUUID();

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ||= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ||= "redis://localhost:6379";
    app = buildApp({ sweepEnabled: false });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  it("incluye al transportista que ofertó aunque ya no esté asignado y excluye envíos ajenos", async () => {
    const repo = createShipmentRepository(app.db);
    const shipment = await repo.create({
      senderId, receiverId, packageType: PackageType.standard_package,
      weightKg: 2, lengthCm: 20, widthCm: 20, heightCm: 20,
      pickupAddress: "Av. Colón 100, Córdoba, Argentina", pickupLat: -31.4, pickupLng: -64.2,
      deliveryAddress: "San Martín 450, X5152 Villa Carlos Paz, Córdoba, Argentina",
      deliveryLat: -31.42, deliveryLng: -64.5,
      pickupDate: new Date("2030-01-01T00:00:00.000Z"),
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 4500,
    });
    await app.db.offer.create({ data: {
      shipmentId: shipment.id, carrierId: formerCarrierId, priceOffered: 4500,
      offeredDate: new Date("2030-01-01T00:00:00.000Z"),
    } });
    const request = (userId: string) => app.inject({ method: "POST", url: "/internal/ledger-origins",
      payload: { userId, shipmentIds: [shipment.id] } });

    const owner = await request(senderId);
    expect(owner.statusCode).toBe(200);
    expect(owner.json()).toEqual([{ id: shipment.id,
      label: `Envío a San Martín 450 #${shipment.id.slice(0, 8)}`, destination: "San Martín 450" }]);
    expect((await request(formerCarrierId)).json()).toEqual(owner.json());
    expect((await request(randomUUID())).json()).toEqual([]);
  });
});
