import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";

/**
 * MOVO-170: GET /shipments/history-with/:userId -- historial de envíos compartido
 * entre el caller (viewer) y otro usuario cualquiera, sin importar el rol de cada uno
 * en cada envío.
 */
describe("GET /shipments/history-with/:userId (Postgres)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;
  const viewerId = randomUUID();
  const otherId = randomUUID();
  const strangerId = randomUUID();

  const baseInput: CreateShipmentInput = {
    senderId: viewerId,
    receiverId: otherId,
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

  function request(userId: string, otherUserId: string) {
    return app.inject({
      method: "GET",
      url: `/shipments/history-with/${otherUserId}`,
      headers: { "x-user-id": userId },
    });
  }

  it("sin ningún envío en común -- count 0, lastSharedAt null, allDelivered false", async () => {
    const response = await request(viewerId, strangerId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sharedShipmentCount: 0, lastSharedAt: null, allDelivered: false });
  });

  it("cuenta un envío donde el viewer es sender y el otro es receiver", async () => {
    await repo.create(baseInput);

    const response = await request(viewerId, otherId);

    expect(response.json()).toMatchObject({ sharedShipmentCount: 1, allDelivered: false });
    expect(response.json().lastSharedAt).not.toBeNull();
  });

  it("cuenta un envío donde el otro es sender y el viewer es carrier (roles cruzados)", async () => {
    const shipment = await repo.create({ ...baseInput, senderId: otherId, receiverId: strangerId });
    await app.db.shipment.update({ where: { id: shipment.id }, data: { carrierId: viewerId } });

    const response = await request(viewerId, otherId);

    expect(response.json().sharedShipmentCount).toBe(1);
  });

  it("no cuenta un envío donde ambos participan pero en roles que no se cruzan (mismo shipment, terceros)", async () => {
    // El viewer es sender y otherId es receiver de un envío distinto al que se
    // consulta -- no debería aparecer en el historial con `strangerId`.
    await repo.create(baseInput);

    const response = await request(viewerId, strangerId);

    expect(response.json().sharedShipmentCount).toBe(0);
  });

  it("allDelivered es true únicamente si TODOS los envíos compartidos llegaron a delivered", async () => {
    const delivered = await repo.create(baseInput);
    await repo.addPhoto(delivered.id, PhotoStage.creation, `shipments/${delivered.id}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(delivered.id, PhotoStage.creation, `shipments/${delivered.id}/creation/${randomUUID()}.jpg`);
    await repo.updateStatus(delivered.id, ShipmentStatus.PUBLISHED, null);
    await repo.updateStatus(delivered.id, ShipmentStatus.ASSIGNMENT_PENDING, null);
    await repo.updateStatus(delivered.id, ShipmentStatus.ASSIGNED, null);
    await repo.updateStatus(delivered.id, ShipmentStatus.IN_TRANSIT, null);
    await repo.updateStatus(delivered.id, ShipmentStatus.DELIVERED, null);

    const onlyDeliveredResponse = await request(viewerId, otherId);
    expect(onlyDeliveredResponse.json()).toMatchObject({ sharedShipmentCount: 1, allDelivered: true });

    await repo.create(baseInput); // segundo envío, se queda en awaiting_receiver_confirmation

    const mixedResponse = await request(viewerId, otherId);
    expect(mixedResponse.json()).toMatchObject({ sharedShipmentCount: 2, allDelivered: false });
  });

  it("401 sin x-user-id", async () => {
    const response = await app.inject({ method: "GET", url: `/shipments/history-with/${otherId}` });
    expect(response.statusCode).toBe(401);
  });
});
