import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus as PrismaShipmentStatus, TripStatus } from "../src/generated/prisma/client";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createRetentionRepository } from "../src/repositories/retention-repository";
import { createHistoryRetentionService } from "../src/services/history-retention-service";
import { UserDeletionClient } from "../src/adapters/users-client";
import { StorageProvider } from "../src/adapters/storage-provider";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";

const NOW = new Date("2032-06-01T00:00:00Z");
const CLOSED_LONG_AGO = new Date("2026-05-01T00:00:00Z");
const DELETED_LONG_AGO = new Date("2026-06-01T00:00:00Z");
const DELETED_RECENTLY = new Date("2030-01-01T00:00:00Z");

describe("purga de historial vencido (MOVO-230, Postgres)", () => {
  let app: FastifyInstance;
  let db: FastifyInstance["db"];
  let shipmentRepo: ShipmentRepository;

  const baseInput: Omit<CreateShipmentInput, "senderId" | "receiverId"> = {
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: null,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.1811,
    pickupDate: new Date("2026-04-20T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 4500,
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({ historyRetentionSweepEnabled: false });
    await app.ready();
    db = app.db;
    shipmentRepo = createShipmentRepository(db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments, shipments.trips RESTART IDENTITY CASCADE");
  });

  interface Parties {
    senderId: string;
    receiverId: string;
    carrierId: string;
  }

  function newParties(): Parties {
    return { senderId: randomUUID(), receiverId: randomUUID(), carrierId: randomUUID() };
  }

  async function createClosedShipment(
    parties: Parties,
    status: PrismaShipmentStatus = "completed",
    lastStatusChangedAt = CLOSED_LONG_AGO,
  ): Promise<string> {
    const shipment = await shipmentRepo.create({ ...baseInput, senderId: parties.senderId, receiverId: parties.receiverId });
    await db.shipment.update({
      where: { id: shipment.id },
      data: { status, lastStatusChangedAt, carrierId: parties.carrierId },
    });
    await db.shipmentPhoto.create({ data: { shipmentId: shipment.id, stage: "pickup", s3Key: `shipments/${shipment.id}/pickup/1.jpg` } });
    await db.chatMessage.create({
      data: { shipmentId: shipment.id, authorId: parties.senderId, body: "hola", clientMessageId: randomUUID() },
    });
    return shipment.id;
  }

  async function createTrip(carrierId: string, status: TripStatus, updatedAt: Date): Promise<string> {
    const trip = await db.trip.create({
      data: {
        carrierId,
        originAddress: "Av. Colón 1234, Córdoba",
        originLat: -31.4201,
        originLng: -64.1888,
        destinationAddress: "Av. San Martín 100, Villa María",
        destinationLat: -32.4104,
        destinationLng: -63.2404,
        departureAt: new Date("2026-04-20T10:00:00Z"),
        vehicleType: "auto",
        status,
      },
    });
    // `@updatedAt` lo pisa Prisma en cada update: se fuerza con SQL crudo.
    await db.$executeRawUnsafe(`UPDATE shipments.trips SET updated_at = $1 WHERE id = $2::uuid`, updatedAt, trip.id);
    return trip.id;
  }

  function deletionClient(dates: Record<string, Date>): UserDeletionClient {
    return {
      findDeletionDates: async (ids) =>
        new Map(ids.filter((id) => dates[id]).map((id) => [id, dates[id] as Date])),
    };
  }

  function storage(): StorageProvider & { deleteObject: ReturnType<typeof vi.fn> } {
    return { deleteObject: vi.fn().mockResolvedValue(undefined) } as unknown as StorageProvider & {
      deleteObject: ReturnType<typeof vi.fn>;
    };
  }

  function allDeleted(parties: Parties, at = DELETED_LONG_AGO): Record<string, Date> {
    return { [parties.senderId]: at, [parties.receiverId]: at, [parties.carrierId]: at };
  }

  it("borra el envío vencido con todo lo que cuelga de él y su foto en S3", async () => {
    const parties = newParties();
    const shipmentId = await createClosedShipment(parties);
    const fakeStorage = storage();
    const service = createHistoryRetentionService(createRetentionRepository(db), deletionClient(allDeleted(parties)), fakeStorage, app.log);

    const result = await service.purgeExpiredHistory(NOW, 5);

    expect(result.shipments).toBe(1);
    expect(await db.shipment.findUnique({ where: { id: shipmentId } })).toBeNull();
    expect(await db.shipmentEvent.count({ where: { shipmentId } })).toBe(0);
    expect(await db.shipmentPhoto.count({ where: { shipmentId } })).toBe(0);
    expect(await db.chatMessage.count({ where: { shipmentId } })).toBe(0);
    expect(fakeStorage.deleteObject).toHaveBeenCalledWith(`shipments/${shipmentId}/pickup/1.jpg`);
  });

  it("no borra si una parte sigue activa, si la última baja es reciente, ni un envío en disputa", async () => {
    const withActive = newParties();
    const activeId = await createClosedShipment(withActive);
    const withRecent = newParties();
    const recentId = await createClosedShipment(withRecent);
    const disputed = newParties();
    const disputedId = await createClosedShipment(disputed, "disputed");

    const { [withActive.receiverId]: _receiverStillActive, ...activeDates } = allDeleted(withActive);
    const dates = {
      ...activeDates,
      ...allDeleted(withRecent),
      [withRecent.carrierId]: DELETED_RECENTLY,
      ...allDeleted(disputed),
    };
    const service = createHistoryRetentionService(createRetentionRepository(db), deletionClient(dates), storage(), app.log);

    const result = await service.purgeExpiredHistory(NOW, 5);

    expect(result.shipments).toBe(0);
    for (const id of [activeId, recentId, disputedId]) {
      expect(await db.shipment.findUnique({ where: { id } })).not.toBeNull();
    }
  });

  it("no borra un envío cerrado hace menos de 5 años aunque las bajas sean viejas", async () => {
    const parties = newParties();
    const id = await createClosedShipment(parties, "completed", new Date("2028-01-01T00:00:00Z"));
    const service = createHistoryRetentionService(createRetentionRepository(db), deletionClient(allDeleted(parties)), storage(), app.log);

    await service.purgeExpiredHistory(NOW, 5);

    expect(await db.shipment.findUnique({ where: { id } })).not.toBeNull();
  });

  it("si falla S3, la fila queda para la próxima corrida", async () => {
    const parties = newParties();
    const id = await createClosedShipment(parties);
    const failing = { deleteObject: vi.fn().mockRejectedValue(new Error("S3 caído")) } as unknown as StorageProvider;
    const service = createHistoryRetentionService(createRetentionRepository(db), deletionClient(allDeleted(parties)), failing, app.log);

    const result = await service.purgeExpiredHistory(NOW, 5);

    expect(result).toMatchObject({ shipments: 0, failed: 1 });
    expect(await db.shipment.findUnique({ where: { id } })).not.toBeNull();
  });

  it("borra los viajes cerrados de un transportista dado de baja hace más de 5 años, y solo esos", async () => {
    const oldCarrier = randomUUID();
    const recentCarrier = randomUUID();
    const expiredTrip = await createTrip(oldCarrier, "completed", CLOSED_LONG_AGO);
    const stillDeclared = await createTrip(oldCarrier, "declared", CLOSED_LONG_AGO);
    const recentTrip = await createTrip(recentCarrier, "cancelled", CLOSED_LONG_AGO);
    const service = createHistoryRetentionService(
      createRetentionRepository(db),
      deletionClient({ [oldCarrier]: DELETED_LONG_AGO, [recentCarrier]: DELETED_RECENTLY }),
      storage(),
      app.log,
    );

    const result = await service.purgeExpiredHistory(NOW, 5);

    expect(result.trips).toBe(1);
    expect(await db.trip.findUnique({ where: { id: expiredTrip } })).toBeNull();
    expect(await db.trip.findUnique({ where: { id: stillDeclared } })).not.toBeNull();
    expect(await db.trip.findUnique({ where: { id: recentTrip } })).not.toBeNull();
  });
});
