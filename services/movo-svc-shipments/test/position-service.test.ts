import { describe, it, expect, vi, afterEach } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import {
  createPositionService,
  CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS,
  PositionRedisClient,
  RealtimePublisher,
} from "../src/services/position-service";
import { PositionRepository } from "../src/repositories/position-repository";
import { ShipmentRepository } from "../src/repositories/shipment-repository";
import { Shipment, PackageType } from "../src/models/shipment";

function fakeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "shipment-1",
    senderId: "sender-1",
    receiverId: "receiver-1",
    carrierId: "carrier-1",
    packageType: PackageType.standard_package,
    weightKg: 2,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: null,
    urgent: false,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4353,
    deliveryLng: -64.1858,
    pickupDate: new Date("2030-01-01T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 2100,
    calculationMethod: "euclidean_linear_v1",
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.IN_TRANSIT,
    lastStatusChangedAt: null,
    deliveredAt: null,
    receiverConfirmationDeadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeShipmentRepository(overrides: Partial<ShipmentRepository> = {}): ShipmentRepository {
  return {
    findById: vi.fn().mockResolvedValue(fakeShipment()),
    ...overrides,
  } as ShipmentRepository;
}

function fakePositionRepository(overrides: Partial<PositionRepository> = {}): PositionRepository {
  return {
    create: vi.fn().mockResolvedValue({}),
    purgeEligibleClosedShipments: vi.fn().mockResolvedValue(0),
    deleteAllForCarrier: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

/** Fake mínimo -- mismo criterio que `createFakeRedis` de `handshake-service.test.ts`,
 * un Map en memoria en vez de mockear ioredis completo. */
function createFakeRedis(): PositionRedisClient {
  const hashes = new Map<string, Record<string, string>>();
  return {
    async hget(key, field) {
      return hashes.get(key)?.[field] ?? null;
    },
    async hset(key, fields) {
      const current = hashes.get(key) ?? {};
      hashes.set(key, { ...current, ...fields });
      return Object.keys(fields).length;
    },
    async expire() {
      return 1;
    },
    async hgetall(key) {
      return hashes.get(key) ?? {};
    },
  };
}

function fakeRealtime(): RealtimePublisher & { messages: Array<{ shipmentId: string; message: unknown }> } {
  const messages: Array<{ shipmentId: string; message: unknown }> = [];
  return {
    messages,
    broadcast(shipmentId, message) {
      messages.push({ shipmentId, message });
    },
  };
}

const basePosition = { lat: -31.42, lng: -64.18, accuracyM: 8, capturedAt: new Date("2026-09-20T12:00:00.000Z") };

describe("position-service (MOVO-202)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("AC2: autorización", () => {
    it("403 AUTH_FORBIDDEN si el caller no es el transportista asignado", async () => {
      const service = createPositionService(
        fakeShipmentRepository(),
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      await expect(service.reportPosition("shipment-1", "otro-usuario", basePosition)).rejects.toMatchObject({
        statusCode: 403,
        code: "AUTH_FORBIDDEN",
      });
    });

    it.each([
      ShipmentStatus.ASSIGNED,
      ShipmentStatus.ASSIGNED_UNFUNDED,
      ShipmentStatus.DELIVERED,
      ShipmentStatus.COMPLETED,
      ShipmentStatus.CANCELLED,
    ])("403 SHIPMENT_NOT_IN_TRANSIT si el envío está en '%s'", async (status) => {
      const shipmentRepository = fakeShipmentRepository({
        findById: vi.fn().mockResolvedValue(fakeShipment({ status })),
      });
      const service = createPositionService(
        shipmentRepository,
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      await expect(service.reportPosition("shipment-1", "carrier-1", basePosition)).rejects.toMatchObject({
        statusCode: 403,
        code: "SHIPMENT_NOT_IN_TRANSIT",
      });
    });

    it("404 NOT_FOUND sobre un envío inexistente", async () => {
      const shipmentRepository = fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(null) });
      const service = createPositionService(
        shipmentRepository,
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      await expect(service.reportPosition("shipment-1", "carrier-1", basePosition)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("acepta al transportista asignado sobre un envío in_transit", async () => {
      const service = createPositionService(
        fakeShipmentRepository(),
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      await expect(service.reportPosition("shipment-1", "carrier-1", basePosition)).resolves.toEqual({
        persisted: true,
      });
    });
  });

  describe("AC4: cadencia de persistencia en Postgres (descarte en backend)", () => {
    it("persiste el primer reporte, descarta los siguientes dentro de los ~45s, y vuelve a persistir pasado ese umbral", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-20T12:00:00.000Z"));

      const positionRepository = fakePositionRepository();
      const service = createPositionService(
        fakeShipmentRepository(),
        positionRepository,
        createFakeRedis(),
        fakeRealtime()
      );

      // t=0s: primer reporte, se persiste.
      await expect(service.reportPosition("shipment-1", "carrier-1", basePosition)).resolves.toEqual({
        persisted: true,
      });

      // Simula el cliente reportando cada 5s (más seguido que la cadencia real) --
      // ninguno de estos 8 reportes (hasta t=40s) debería persistir.
      for (let i = 1; i <= 8; i++) {
        vi.setSystemTime(new Date(Date.now() + 5_000));
        await expect(service.reportPosition("shipment-1", "carrier-1", basePosition)).resolves.toEqual({
          persisted: false,
        });
      }
      expect(positionRepository.create).toHaveBeenCalledTimes(1);

      // t=45s desde el último persistido: vuelve a persistir.
      vi.setSystemTime(new Date(new Date("2026-09-20T12:00:00.000Z").getTime() + CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS));
      await expect(service.reportPosition("shipment-1", "carrier-1", basePosition)).resolves.toEqual({
        persisted: true,
      });
      expect(positionRepository.create).toHaveBeenCalledTimes(2);
    });

    it("AC3: la última posición conocida en Redis se actualiza SIEMPRE, aunque el reporte no se persista", async () => {
      const service = createPositionService(
        fakeShipmentRepository(),
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      await service.reportPosition("shipment-1", "carrier-1", basePosition);
      await service.reportPosition("shipment-1", "carrier-1", { ...basePosition, lat: -31.5, lng: -64.5 });

      const lastKnown = await service.getLastKnownPosition("shipment-1");
      expect(lastKnown).toMatchObject({ lat: -31.5, lng: -64.5 });
    });
  });

  describe("AC5: difusión sin esperar la persistencia", () => {
    it("difunde CADA reporte recibido, incluso los que la cadencia descarta", async () => {
      const realtime = fakeRealtime();
      const service = createPositionService(
        fakeShipmentRepository(),
        fakePositionRepository(),
        createFakeRedis(),
        realtime
      );

      await service.reportPosition("shipment-1", "carrier-1", basePosition);
      await service.reportPosition("shipment-1", "carrier-1", basePosition);
      await service.reportPosition("shipment-1", "carrier-1", basePosition);

      expect(realtime.messages).toHaveLength(3);
      expect(realtime.messages[0].shipmentId).toBe("shipment-1");
      expect(realtime.messages[0].message).toMatchObject({ type: "position", lat: basePosition.lat });
    });
  });

  describe("getLastKnownPosition", () => {
    it("devuelve null si nunca se reportó nada", async () => {
      const service = createPositionService(
        fakeShipmentRepository(),
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      await expect(service.getLastKnownPosition("shipment-sin-datos")).resolves.toBeNull();
    });
  });

  describe("AC6: purga periódica", () => {
    it("delega en el repositorio con el retentionDays configurado", async () => {
      const positionRepository = fakePositionRepository({
        purgeEligibleClosedShipments: vi.fn().mockResolvedValue(3),
      });
      const service = createPositionService(
        fakeShipmentRepository(),
        positionRepository,
        createFakeRedis(),
        fakeRealtime()
      );

      const deleted = await service.purgeExpiredPositions(30);

      expect(deleted).toBe(3);
      expect(positionRepository.purgeEligibleClosedShipments).toHaveBeenCalledWith(expect.any(Date), 30);
    });
  });

  describe("AC7: supresión de cuenta", () => {
    it("delega en el repositorio para borrar todas las posiciones del transportista", async () => {
      const positionRepository = fakePositionRepository({
        deleteAllForCarrier: vi.fn().mockResolvedValue(5),
      });
      const service = createPositionService(
        fakeShipmentRepository(),
        positionRepository,
        createFakeRedis(),
        fakeRealtime()
      );

      await expect(service.deletePositionsForCarrier("carrier-1")).resolves.toBe(5);
      expect(positionRepository.deleteAllForCarrier).toHaveBeenCalledWith("carrier-1");
    });
  });
});
