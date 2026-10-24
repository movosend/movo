import { describe, it, expect, vi, afterEach } from "vitest";
import { ShipmentStatus, TripStatus } from "@movo/shared";
import {
  createPositionService,
  CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS,
  PositionRedisClient,
  RealtimePublisher,
  UPDATE_LAST_KNOWN_IF_NEWER_SCRIPT,
  CAPTURED_AT_CLOCK_SKEW_TOLERANCE_MS,
} from "../src/services/position-service";
import { PositionRepository } from "../src/repositories/position-repository";
import { ShipmentRepository, ShipmentTrackingContext } from "../src/repositories/shipment-repository";
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
  const repo: Partial<ShipmentRepository> = {
    findById: vi.fn().mockResolvedValue(fakeShipment()),
    ...overrides,
  };
  if (!repo.findTrackingContext) {
    repo.findTrackingContext = vi.fn().mockImplementation(async (id: string) => {
      const s = await repo.findById!(id);
      if (!s) return null;
      return {
        shipment: s,
        trip: {
          id: "trip-1",
          status: TripStatus.ACTIVE,
          carrierId: s.carrierId ?? "carrier-1",
        },
        activeShipmentIds: [s.id],
      };
    });
  }
  return repo as ShipmentRepository;
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
  const strings = new Map<string, { value: string; expiresAt: number }>();
  return {
    // `SET key value PX ttl NX`: atómico por construcción (sin `await` entre el chequeo
    // y la escritura), igual que en Redis real. Expira contra `Date.now()`, así que
    // respeta `vi.useFakeTimers()`.
    async set(key, value, _mode, ttlMs, _flag) {
      const existing = strings.get(key);
      if (existing && existing.expiresAt > Date.now()) return null;
      strings.set(key, { value, expiresAt: Date.now() + ttlMs });
      return "OK";
    },
    async del(key) {
      return strings.delete(key) ? 1 : 0;
    },
    async hget(key, field) {
      return hashes.get(key)?.[field] ?? null;
    },
    // Emula `UPDATE_LAST_KNOWN_IF_NEWER_SCRIPT` (Lua, atómico en Redis real -- acá lo es
    // por no haber `await` entre la lectura y la escritura). La semántica real contra
    // Redis se ejercita en `positions-report.integration.test.ts`.
    async eval(script, _numKeys, key, capturedAtMs, lat, lng, accuracyM, capturedAt, recordedAt) {
      if (script !== UPDATE_LAST_KNOWN_IF_NEWER_SCRIPT) throw new Error("script inesperado");
      const current = hashes.get(key);
      if (current?.capturedAtMs && Number(current.capturedAtMs) >= Number(capturedAtMs)) return 0;
      hashes.set(key, { capturedAtMs, lat, lng, accuracyM, capturedAt, recordedAt });
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

/** Inicio del tramo de cadencia que contiene a `iso`: los tests que miden tramos parten de
 * un borde para que un offset chico no cruce al tramo siguiente. */
function alignedBucketStart(iso: string): number {
  return (
    Math.floor(new Date(iso).getTime() / CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS) *
    CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS
  );
}

const basePosition = { lat: -31.42, lng: -64.18, accuracyM: 8, capturedAt: new Date("2026-09-20T12:00:00.000Z") };

describe("position-service (MOVO-202 / MOVO-251)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("AC2: autorización (adaptado por MOVO-251)", () => {
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
      ShipmentStatus.ASSIGNED_UNFUNDED,
      ShipmentStatus.DELIVERED,
      ShipmentStatus.COMPLETED,
      ShipmentStatus.CANCELLED,
    ])("403 SHIPMENT_NOT_TRACKABLE si el envío está en '%s'", async (status) => {
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
        code: "SHIPMENT_NOT_TRACKABLE",
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

    it("MOVO-251: acepta al transportista asignado sobre un envío assigned si el viaje está active", async () => {
      const shipmentRepository = fakeShipmentRepository({
        findById: vi.fn().mockResolvedValue(fakeShipment({ status: ShipmentStatus.ASSIGNED })),
      });
      const service = createPositionService(
        shipmentRepository,
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      // MOVO-270 (AC2): se acepta, pero sin custodia no se guarda traza.
      await expect(service.reportPosition("shipment-1", "carrier-1", basePosition)).resolves.toEqual({
        persisted: false,
      });
    });
  });

  describe("AC4: cadencia de persistencia en Postgres (descarte en backend)", () => {
    it("persiste el primer reporte, descarta los siguientes del mismo tramo de 45s, y vuelve a persistir en el tramo siguiente", async () => {
      // Instante alineado al inicio de un tramo, para que +40s no cruce el borde.
      const t0 = alignedBucketStart("2026-09-20T12:00:00.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(new Date(t0));

      const positionRepository = fakePositionRepository();
      const service = createPositionService(
        fakeShipmentRepository(),
        positionRepository,
        createFakeRedis(),
        fakeRealtime()
      );
      const reportAt = (offsetMs: number) =>
        service.reportPosition("shipment-1", "carrier-1", { ...basePosition, capturedAt: new Date(t0 + offsetMs) });

      await expect(reportAt(0)).resolves.toEqual({ persisted: true });

      // Cliente reportando cada 5s (más seguido que la cadencia real): ninguno de estos
      // 8 reportes (hasta t=40s) cae en un tramo nuevo.
      for (let i = 1; i <= 8; i++) {
        vi.setSystemTime(new Date(t0 + i * 5_000));
        await expect(reportAt(i * 5_000)).resolves.toEqual({ persisted: false });
      }
      expect(positionRepository.create).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date(t0 + CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS));
      await expect(reportAt(CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS)).resolves.toEqual({ persisted: true });
      expect(positionRepository.create).toHaveBeenCalledTimes(2);
    });

    it("AC2 (MOVO-250): una tanda de 30 posiciones cada 5s de hace 3 minutos persiste una por tramo de 45s, sin importar el orden de llegada", async () => {
      const t0 = alignedBucketStart("2026-09-20T12:00:00.000Z");
      vi.useFakeTimers();
      // Llegan todas de golpe, 3 min después de la primera captura.
      vi.setSystemTime(new Date(t0 + 3 * 60_000));

      const captured = Array.from({ length: 30 }, (_, i) => new Date(t0 + i * 5_000));
      // 30 * 5s = 145s de traza: tramos [0,45), [45,90), [90,135), [135,180) -> 4 tramos.
      // Orden de llegada mezclado de forma determinística.
      const shuffled = [...captured].sort((x, y) => ((x.getTime() * 7919) % 31) - ((y.getTime() * 7919) % 31));

      const positionRepository = fakePositionRepository();
      const service = createPositionService(
        fakeShipmentRepository(),
        positionRepository,
        createFakeRedis(),
        fakeRealtime()
      );

      for (const capturedAt of shuffled) {
        await service.reportPosition("shipment-1", "carrier-1", { ...basePosition, capturedAt });
      }

      const persistedBuckets = (positionRepository.create as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
        Math.floor((c[0].capturedAt as Date).getTime() / CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS)
      );
      expect(persistedBuckets).toHaveLength(4);
      expect(new Set(persistedBuckets).size).toBe(4);
    });

    it("reportes concurrentes dentro de la misma ventana persisten UNA sola vez (claim atómico de la cadencia)", async () => {
      const positionRepository = fakePositionRepository();
      const service = createPositionService(
        fakeShipmentRepository(),
        positionRepository,
        createFakeRedis(),
        fakeRealtime()
      );

      // Un retry del cliente ante un timeout, o dos requests que se superponen: ambos
      // llegan antes de que cualquiera haya terminado.
      const results = await Promise.all([
        service.reportPosition("shipment-1", "carrier-1", basePosition),
        service.reportPosition("shipment-1", "carrier-1", basePosition),
        service.reportPosition("shipment-1", "carrier-1", basePosition),
      ]);

      expect(results.filter((r) => r.persisted)).toHaveLength(1);
      expect(positionRepository.create).toHaveBeenCalledTimes(1);
    });

    it("si persistir falla, libera el claim para que el próximo reporte pueda reintentar", async () => {
      const create = vi.fn().mockRejectedValueOnce(new Error("db caída")).mockResolvedValue({});
      const service = createPositionService(
        fakeShipmentRepository(),
        fakePositionRepository({ create }),
        createFakeRedis(),
        fakeRealtime()
      );

      await expect(service.reportPosition("shipment-1", "carrier-1", basePosition)).rejects.toThrow("db caída");
      await expect(service.reportPosition("shipment-1", "carrier-1", basePosition)).resolves.toEqual({
        persisted: true,
      });
      expect(create).toHaveBeenCalledTimes(2);
    });

    it("AC3: la última posición conocida en Redis se actualiza con cada reporte más reciente, aunque no se persista", async () => {
      const service = createPositionService(
        fakeShipmentRepository(),
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      await service.reportPosition("shipment-1", "carrier-1", basePosition);
      await service.reportPosition("shipment-1", "carrier-1", {
        ...basePosition,
        lat: -31.5,
        lng: -64.5,
        capturedAt: new Date(basePosition.capturedAt.getTime() + 1_000),
      });

      const lastKnown = await service.getLastKnownPosition("shipment-1");
      expect(lastKnown).toMatchObject({ lat: -31.5, lng: -64.5 });
    });
  });

  describe("AC1 (MOVO-250): la última posición conocida nunca retrocede", () => {
    it("reportar la actual y después una más vieja conserva la actual en Redis y no difunde la vieja", async () => {
      const realtime = fakeRealtime();
      const positionRepository = fakePositionRepository();
      const service = createPositionService(
        fakeShipmentRepository(),
        positionRepository,
        createFakeRedis(),
        realtime
      );
      const current = { ...basePosition, lat: -31.5, capturedAt: new Date("2026-09-20T12:10:00.000Z") };
      const older = { ...basePosition, lat: -31.1, capturedAt: new Date("2026-09-20T12:00:00.000Z") };

      await service.reportPosition("shipment-1", "carrier-1", current);
      // Vaciado de la cola offline: llega una posición más vieja de OTRO tramo.
      const result = await service.reportPosition("shipment-1", "carrier-1", older);

      expect((await service.getLastKnownPosition("shipment-1"))?.lat).toBe(-31.5);
      expect(realtime.messages).toHaveLength(1);
      expect(realtime.messages[0].message).toMatchObject({ lat: -31.5 });
      // La vieja igual entra a la traza (evidencia de disputa), solo no mueve el marcador.
      expect(result).toEqual({ persisted: true });
      expect(positionRepository.create).toHaveBeenCalledTimes(2);
    });

    it("un capturedAt igual al guardado tampoco actualiza ni difunde", async () => {
      const realtime = fakeRealtime();
      const service = createPositionService(
        fakeShipmentRepository(),
        fakePositionRepository(),
        createFakeRedis(),
        realtime
      );
      await service.reportPosition("shipment-1", "carrier-1", basePosition);
      await service.reportPosition("shipment-1", "carrier-1", { ...basePosition, lat: -31.9 });

      expect(realtime.messages).toHaveLength(1);
      expect((await service.getLastKnownPosition("shipment-1"))?.lat).toBe(basePosition.lat);
    });
  });

  describe("AC5: difusión sin esperar la persistencia", () => {
    it("difunde cada reporte que avanza la última posición, incluso los que la cadencia no persiste", async () => {
      const realtime = fakeRealtime();
      const service = createPositionService(
        fakeShipmentRepository(),
        fakePositionRepository(),
        createFakeRedis(),
        realtime
      );

      for (let i = 0; i < 3; i++) {
        await service.reportPosition("shipment-1", "carrier-1", {
          ...basePosition,
          capturedAt: new Date(basePosition.capturedAt.getTime() + i * 1_000),
        });
      }

      expect(realtime.messages).toHaveLength(3);
      expect(realtime.messages[0].shipmentId).toBe("shipment-1");
      expect(realtime.messages[0].message).toMatchObject({ type: "position", lat: basePosition.lat });
    });
  });

  describe("AC3 (MOVO-250): validación de capturedAt", () => {
    it("rechaza un capturedAt en el futuro más allá de la tolerancia, acepta uno dentro", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-20T12:00:00.000Z"));
      const service = createPositionService(
        fakeShipmentRepository(),
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );
      const at = (offsetMs: number) => new Date(Date.now() + offsetMs);

      await expect(
        service.reportPosition("shipment-1", "carrier-1", {
          ...basePosition,
          capturedAt: at(CAPTURED_AT_CLOCK_SKEW_TOLERANCE_MS + 1_000),
        })
      ).rejects.toMatchObject({ statusCode: 422, code: "INVALID_CAPTURED_AT" });
      await expect(
        service.reportPosition("shipment-1", "carrier-1", {
          ...basePosition,
          capturedAt: at(CAPTURED_AT_CLOCK_SKEW_TOLERANCE_MS - 1_000),
        })
      ).resolves.toEqual({ persisted: true });
    });

    it("rechaza un capturedAt anterior al inicio del tránsito más allá de la tolerancia, acepta uno dentro", async () => {
      const inTransitSince = new Date("2026-09-20T11:00:00.000Z");
      const service = createPositionService(
        fakeShipmentRepository({
          findById: vi.fn().mockResolvedValue(fakeShipment({ lastStatusChangedAt: inTransitSince })),
        }),
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      await expect(
        service.reportPosition("shipment-1", "carrier-1", {
          ...basePosition,
          capturedAt: new Date(inTransitSince.getTime() - CAPTURED_AT_CLOCK_SKEW_TOLERANCE_MS - 1_000),
        })
      ).rejects.toMatchObject({ code: "INVALID_CAPTURED_AT" });
      // Review de PR #190: una muestra unos segundos anterior al handshake (reloj atrasado
      // o GPS que muestreó antes de la confirmación) no puede rechazarse.
      await expect(
        service.reportPosition("shipment-1", "carrier-1", {
          ...basePosition,
          capturedAt: new Date(inTransitSince.getTime() - 10_000),
        })
      ).resolves.toEqual({ persisted: true });
    });
  });

  describe("AC4 (MOVO-250): lote con un resultado por ítem", () => {
    it("lote mixto: envío en tránsito, envío entregado, envío ajeno, inexistente y capturedAt inválido", async () => {
      const shipments: Record<string, Shipment | null> = {
        "in-transit": fakeShipment({ id: "in-transit" }),
        delivered: fakeShipment({ id: "delivered", status: ShipmentStatus.DELIVERED }),
        ajeno: fakeShipment({ id: "ajeno", carrierId: "otro-carrier" }),
        fantasma: null,
      };
      const positionRepository = fakePositionRepository();
      const service = createPositionService(
        fakeShipmentRepository({ findById: vi.fn(async (id: string) => shipments[id] ?? null) }),
        positionRepository,
        createFakeRedis(),
        fakeRealtime()
      );
      const future = new Date(Date.now() + 60 * 60_000);

      const results = await service.reportPositions("carrier-1", [
        { ...basePosition, shipmentId: "in-transit" },
        { ...basePosition, shipmentId: "delivered" },
        { ...basePosition, shipmentId: "ajeno" },
        { ...basePosition, shipmentId: "fantasma" },
        { ...basePosition, shipmentId: "in-transit", capturedAt: future },
      ]);

      expect(results).toEqual([
        { index: 0, shipmentId: "in-transit", status: "accepted", persisted: true },
        { index: 1, shipmentId: "delivered", status: "rejected", code: "SHIPMENT_NOT_TRACKABLE" },
        { index: 2, shipmentId: "ajeno", status: "rejected", code: "FORBIDDEN" },
        { index: 3, shipmentId: "fantasma", status: "rejected", code: "NOT_FOUND" },
        { index: 4, shipmentId: "in-transit", status: "rejected", code: "INVALID_CAPTURED_AT" },
      ]);
      expect(positionRepository.create).toHaveBeenCalledTimes(1);
    });

    it("lee cada envío distinto una sola vez por lote", async () => {
      const findById = vi.fn().mockResolvedValue(fakeShipment());
      const service = createPositionService(
        fakeShipmentRepository({ findById }),
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      await service.reportPositions(
        "carrier-1",
        Array.from({ length: 5 }, (_, i) => ({
          ...basePosition,
          shipmentId: "shipment-1",
          capturedAt: new Date(basePosition.capturedAt.getTime() + i * 60_000),
        }))
      );

      expect(findById).toHaveBeenCalledTimes(1);
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

  describe("MOVO-251: gateo y persistencia por Trip", () => {
    it("un envío assigned dentro de un trip active acepta la posición y la difunde, sin guardar traza (MOVO-270 AC2)", async () => {
      const shipmentRepository = fakeShipmentRepository({
        findTrackingContext: vi.fn().mockResolvedValue({
          shipment: fakeShipment({ id: "shipment-assigned", status: ShipmentStatus.ASSIGNED }),
          trip: { id: "trip-active-1", status: TripStatus.ACTIVE, carrierId: "carrier-1" },
          activeShipmentIds: ["shipment-assigned"],
          persistableShipmentIds: [],
        }),
      });
      const positionRepository = fakePositionRepository();
      const realtime = fakeRealtime();
      const service = createPositionService(shipmentRepository, positionRepository, createFakeRedis(), realtime);

      await expect(
        service.reportPosition("shipment-assigned", "carrier-1", basePosition)
      ).resolves.toEqual({ persisted: false });
      expect(positionRepository.create).not.toHaveBeenCalled();
      expect(realtime.messages).toEqual([
        { shipmentId: "shipment-assigned", message: expect.objectContaining({ type: "position" }) },
      ]);
    });

    it("MOVO-270 (AC2): en un viaje mixto la fila se asocia al envío in_transit aunque reporte el assigned", async () => {
      const shipmentRepository = fakeShipmentRepository({
        findTrackingContext: vi.fn().mockResolvedValue({
          shipment: fakeShipment({ id: "shipment-assigned", status: ShipmentStatus.ASSIGNED }),
          trip: { id: "trip-active-1", status: TripStatus.ACTIVE, carrierId: "carrier-1" },
          activeShipmentIds: ["shipment-assigned", "shipment-in-transit"],
          persistableShipmentIds: ["shipment-in-transit"],
        }),
      });
      const positionRepository = fakePositionRepository();
      const service = createPositionService(shipmentRepository, positionRepository, createFakeRedis(), fakeRealtime());

      await expect(
        service.reportPosition("shipment-assigned", "carrier-1", { ...basePosition, mocked: true })
      ).resolves.toEqual({ persisted: true });
      expect(positionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ shipmentId: "shipment-in-transit", tripId: "trip-active-1", mocked: true })
      );
    });

    it("un envío assigned cuyo trip no está active (todavía declared) rechaza con 403 SHIPMENT_NOT_TRACKABLE", async () => {
      const shipmentRepository = fakeShipmentRepository({
        findTrackingContext: vi.fn().mockResolvedValue({
          shipment: fakeShipment({ id: "shipment-assigned", status: ShipmentStatus.ASSIGNED }),
          trip: { id: "trip-declared-1", status: TripStatus.DECLARED, carrierId: "carrier-1" },
          activeShipmentIds: ["shipment-assigned"],
        }),
      });
      const service = createPositionService(
        shipmentRepository,
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      await expect(
        service.reportPosition("shipment-assigned", "carrier-1", basePosition)
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "SHIPMENT_NOT_TRACKABLE",
      });
    });

    it("un envío sin viaje asociado rechaza con 403 SHIPMENT_NOT_TRACKABLE", async () => {
      const shipmentRepository = fakeShipmentRepository({
        findTrackingContext: vi.fn().mockResolvedValue({
          shipment: fakeShipment({ id: "shipment-no-trip", status: ShipmentStatus.ASSIGNED }),
          trip: null,
          activeShipmentIds: ["shipment-no-trip"],
        }),
      });
      const service = createPositionService(
        shipmentRepository,
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      await expect(
        service.reportPosition("shipment-no-trip", "carrier-1", basePosition)
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "SHIPMENT_NOT_TRACKABLE",
      });
    });

    it("dos envíos del mismo trip, misma posición física reportada una sola vez, guardan una sola fila en carrier_positions con ese trip_id", async () => {
      const tripId = "trip-consolidated-1";
      const shipmentRepository = fakeShipmentRepository({
        findTrackingContext: vi.fn().mockImplementation(async (id: string) => ({
          shipment: fakeShipment({ id, status: ShipmentStatus.IN_TRANSIT }),
          trip: { id: tripId, status: TripStatus.ACTIVE, carrierId: "carrier-1" },
          activeShipmentIds: ["shipment-A", "shipment-B"],
        })),
      });
      const positionRepository = fakePositionRepository();
      const service = createPositionService(
        shipmentRepository,
        positionRepository,
        createFakeRedis(),
        fakeRealtime()
      );

      // Reporte para shipment-A: primer reporte del tramo, persiste
      const resA = await service.reportPosition("shipment-A", "carrier-1", basePosition);
      expect(resA).toEqual({ persisted: true });

      // Reporte para shipment-B con la misma posición física (mismo capturedAt y tripId): descarta cadencia
      const resB = await service.reportPosition("shipment-B", "carrier-1", basePosition);
      expect(resB).toEqual({ persisted: false });

      // Se llamó a create exactamente una vez con el tripId correspondiente
      expect(positionRepository.create).toHaveBeenCalledTimes(1);
      expect(positionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shipmentId: "shipment-A",
          tripId,
        })
      );
    });

    it("envío que sale del trip (oferta cancelada o estado terminal) deja de aparecer en el read-side (getLastKnownPosition) aunque el trip siga activo", async () => {
      const tripId = "trip-active-1";
      let shipmentStatus = ShipmentStatus.IN_TRANSIT;
      let hasTrip = true;

      const shipmentRepository = fakeShipmentRepository({
        findTrackingContext: vi.fn().mockImplementation(async () => ({
          shipment: fakeShipment({ id: "shipment-1", status: shipmentStatus }),
          trip: hasTrip ? { id: tripId, status: TripStatus.ACTIVE, carrierId: "carrier-1" } : null,
          activeShipmentIds: ["shipment-1"],
        })),
      });

      const redis = createFakeRedis();
      const service = createPositionService(
        shipmentRepository,
        fakePositionRepository(),
        redis,
        fakeRealtime()
      );

      // Reportamos una posición para que quede en Redis bajo la clave del viaje
      await service.reportPosition("shipment-1", "carrier-1", basePosition);

      // Mientras el envío está en tránsito, el read-side resuelve la posición
      const knownWhileActive = await service.getLastKnownPosition("shipment-1");
      expect(knownWhileActive).toMatchObject({ lat: basePosition.lat, lng: basePosition.lng });

      // Caso 1: el envío pasa a DELIVERED
      shipmentStatus = ShipmentStatus.DELIVERED;
      expect(await service.getLastKnownPosition("shipment-1")).toBeNull();

      // Caso 1b: el envío está en ASSIGNED_UNFUNDED (fondos no confirmados aún, no trackeable)
      shipmentStatus = ShipmentStatus.ASSIGNED_UNFUNDED;
      expect(await service.getLastKnownPosition("shipment-1")).toBeNull();

      // Caso 2: el envío vuelve a ASSIGNED pero se desvincula del viaje (oferta cancelada)
      shipmentStatus = ShipmentStatus.ASSIGNED;
      hasTrip = false;
      expect(await service.getLastKnownPosition("shipment-1")).toBeNull();

      // La posición del viaje en Redis sigue viva para otros envíos
      hasTrip = true;
      shipmentStatus = ShipmentStatus.IN_TRANSIT;
      expect(await service.getLastKnownPosition("shipment-1")).not.toBeNull();
    });

    it("difunde a todos los envíos activos del viaje cuando entra una nueva posición", async () => {
      const tripId = "trip-multi-1";
      const realtime = fakeRealtime();
      const shipmentRepository = fakeShipmentRepository({
        findTrackingContext: vi.fn().mockResolvedValue({
          shipment: fakeShipment({ id: "shipment-A", status: ShipmentStatus.IN_TRANSIT }),
          trip: { id: tripId, status: TripStatus.ACTIVE, carrierId: "carrier-1" },
          activeShipmentIds: ["shipment-A", "shipment-B"],
        }),
      });

      const service = createPositionService(
        shipmentRepository,
        fakePositionRepository(),
        createFakeRedis(),
        realtime
      );

      await service.reportPosition("shipment-A", "carrier-1", basePosition);

      // Se difundió a ambos envíos activos del viaje
      expect(realtime.messages).toHaveLength(2);
      expect(realtime.messages.map((m) => m.shipmentId)).toEqual(["shipment-A", "shipment-B"]);
    });
  });

  describe("MOVO-240: aviso de transportista cerca", () => {
    // ~1,5 km y ~3 km al norte del punto de retiro de `fakeShipment` (-31.4201, -64.1888).
    const NEAR_PICKUP = { lat: -31.4066, lng: -64.1888 };
    const FAR_FROM_PICKUP = { lat: -31.3931, lng: -64.1888 };
    // ~1,5 km del punto de entrega (-31.4353, -64.1858).
    const NEAR_DELIVERY = { lat: -31.4488, lng: -64.1858 };

    function at(coords: { lat: number; lng: number }, minute: number) {
      return { ...coords, accuracyM: 8, capturedAt: new Date(Date.UTC(2026, 8, 20, 12, minute)) };
    }

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    function setup(shipments: Shipment[], sendPush = vi.fn().mockResolvedValue(undefined)) {
      const byId = new Map(shipments.map((shipment) => [shipment.id, shipment]));
      const shipmentRepository = fakeShipmentRepository({
        findById: vi.fn(async (id: string) => byId.get(id) ?? null),
        findTrackingContext: vi.fn(async (id: string) => ({
          shipment: byId.get(id)!,
          trip: { id: "trip-1", status: TripStatus.ACTIVE, carrierId: "carrier-1" },
          activeShipmentIds: shipments.map((shipment) => shipment.id),
        })),
      });
      const redis = createFakeRedis();
      const service = createPositionService(
        shipmentRepository,
        fakePositionRepository(),
        redis,
        fakeRealtime(),
        { warn: vi.fn() },
        { sendPush }
      );
      return { service, sendPush, redis };
    }

    it("a menos de 2 km del retiro avisa al emisor una sola vez", async () => {
      const { service, sendPush } = setup([fakeShipment({ status: ShipmentStatus.ASSIGNED })]);

      await service.reportPosition("shipment-1", "carrier-1", at(NEAR_PICKUP, 0));
      await service.reportPosition("shipment-1", "carrier-1", at(NEAR_PICKUP, 1));
      await flush();

      expect(sendPush).toHaveBeenCalledTimes(1);
      expect(sendPush).toHaveBeenCalledWith({
        userId: "sender-1",
        title: "Tu transportista está por llegar",
        body: "Está a menos de 2 km del punto de retiro.",
        category: "proximity",
        data: { type: "carrier_nearby", shipmentId: "shipment-1" },
      });
    });

    it("a más de 2 km no avisa", async () => {
      const { service, sendPush } = setup([fakeShipment({ status: ShipmentStatus.ASSIGNED })]);

      await service.reportPosition("shipment-1", "carrier-1", at(FAR_FROM_PICKUP, 0));
      await flush();

      expect(sendPush).not.toHaveBeenCalled();
    });

    it("en tránsito avisa al receptor cerca de la entrega", async () => {
      const { service, sendPush } = setup([fakeShipment({ status: ShipmentStatus.IN_TRANSIT })]);

      await service.reportPosition("shipment-1", "carrier-1", at(NEAR_DELIVERY, 0));
      await flush();

      expect(sendPush).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "receiver-1", title: "Tu paquete está por llegar" })
      );
    });

    it("con retiro y entrega cerca, no avisa la entrega mientras siga en el radio del retiro", async () => {
      // Retiro ~1,5 km al sur de la entrega (-31.4353, -64.1858).
      const { service, sendPush } = setup([
        fakeShipment({ status: ShipmentStatus.IN_TRANSIT, pickupLat: -31.4488, pickupLng: -64.1858 }),
      ]);

      // En la entrega misma, pero todavía a 1,5 km del retiro: recién se retiró.
      await service.reportPosition("shipment-1", "carrier-1", at({ lat: -31.4353, lng: -64.1858 }, 0));
      await flush();
      expect(sendPush).not.toHaveBeenCalled();

      // ~1,5 km al norte de la entrega y ~3 km del retiro: ya salió del radio del retiro.
      await service.reportPosition("shipment-1", "carrier-1", at({ lat: -31.4218, lng: -64.1858 }, 1));
      await flush();
      expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ userId: "receiver-1" }));
    });

    it("si falla la lectura de un envío, evalúa igual los demás del viaje", async () => {
      const shipmentB = fakeShipment({ id: "shipment-B", senderId: "sender-B", status: ShipmentStatus.ASSIGNED });
      const sendPush = vi.fn().mockResolvedValue(undefined);
      const findById = vi.fn(async (id: string) => {
        if (id === "shipment-A") throw new Error("Postgres caído");
        return shipmentB;
      });
      const service = createPositionService(
        fakeShipmentRepository({
          findById,
          findTrackingContext: vi.fn().mockResolvedValue({
            shipment: fakeShipment({ id: "shipment-A", status: ShipmentStatus.ASSIGNED }),
            trip: { id: "trip-1", status: TripStatus.ACTIVE, carrierId: "carrier-1" },
            activeShipmentIds: ["shipment-A", "shipment-B"],
          }),
        }),
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime(),
        { warn: vi.fn() },
        { sendPush }
      );

      await service.reportPosition("shipment-A", "carrier-1", at(NEAR_PICKUP, 0));
      await flush();

      expect(sendPush).toHaveBeenCalledTimes(1);
      expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ userId: "sender-B" }));
    });

    it("relee el envío antes de avisar: uno que ya no está asignado no recibe el aviso", async () => {
      const sendPush = vi.fn().mockResolvedValue(undefined);
      const service = createPositionService(
        fakeShipmentRepository({
          // El contexto de tracking lo vio asignado, pero al evaluar ya se canceló.
          findTrackingContext: vi.fn().mockResolvedValue({
            shipment: fakeShipment({ status: ShipmentStatus.ASSIGNED }),
            trip: { id: "trip-1", status: TripStatus.ACTIVE, carrierId: "carrier-1" },
            activeShipmentIds: ["shipment-1"],
          }),
          findById: vi.fn().mockResolvedValue(fakeShipment({ status: ShipmentStatus.CANCELLED })),
        }),
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime(),
        { warn: vi.fn() },
        { sendPush }
      );

      await service.reportPosition("shipment-1", "carrier-1", at(NEAR_PICKUP, 0));
      await flush();

      expect(sendPush).not.toHaveBeenCalled();
    });

    it("en un lote evalúa una sola vez por viaje, con la posición más reciente", async () => {
      const { service, sendPush } = setup([fakeShipment({ status: ShipmentStatus.ASSIGNED })]);

      // La más reciente (minuto 2) está lejos: aunque las anteriores estén cerca, no avisa.
      await service.reportPositions("carrier-1", [
        { shipmentId: "shipment-1", ...at(NEAR_PICKUP, 0) },
        { shipmentId: "shipment-1", ...at(NEAR_PICKUP, 1) },
        { shipmentId: "shipment-1", ...at(FAR_FROM_PICKUP, 2) },
      ]);
      await flush();
      expect(sendPush).not.toHaveBeenCalled();

      await service.reportPositions("carrier-1", [
        { shipmentId: "shipment-1", ...at(FAR_FROM_PICKUP, 3) },
        { shipmentId: "shipment-1", ...at(NEAR_PICKUP, 4) },
      ]);
      await flush();
      expect(sendPush).toHaveBeenCalledTimes(1);
    });

    it("una posición vieja que no avanza el marcador no evalúa", async () => {
      const { service, sendPush } = setup([fakeShipment({ status: ShipmentStatus.ASSIGNED })]);

      await service.reportPosition("shipment-1", "carrier-1", at(FAR_FROM_PICKUP, 5));
      // Llega tarde de la cola offline: abre un tramo nuevo pero es anterior a la última.
      await service.reportPosition("shipment-1", "carrier-1", at(NEAR_PICKUP, 0));
      await flush();

      expect(sendPush).not.toHaveBeenCalled();
    });

    it("evalúa todos los envíos del viaje, no solo el reportado", async () => {
      const { service, sendPush } = setup([
        fakeShipment({ id: "shipment-A", status: ShipmentStatus.IN_TRANSIT }),
        fakeShipment({ id: "shipment-B", senderId: "sender-B", status: ShipmentStatus.ASSIGNED }),
      ]);

      await service.reportPosition("shipment-A", "carrier-1", at(NEAR_PICKUP, 0));
      await flush();

      expect(sendPush).toHaveBeenCalledTimes(1);
      expect(sendPush).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "sender-B", data: { type: "carrier_nearby", shipmentId: "shipment-B" } })
      );
    });

    it("un push fallido no rompe la ingesta y se reintenta con la próxima posición", async () => {
      const sendPush = vi.fn().mockRejectedValueOnce(new Error("svc-users caído")).mockResolvedValue(undefined);
      const { service } = setup([fakeShipment({ status: ShipmentStatus.ASSIGNED })], sendPush);

      await expect(service.reportPosition("shipment-1", "carrier-1", at(NEAR_PICKUP, 0))).resolves.toEqual({
        persisted: false,
      });
      await flush();
      await service.reportPosition("shipment-1", "carrier-1", at(NEAR_PICKUP, 1));
      await flush();

      expect(sendPush).toHaveBeenCalledTimes(2);
    });

    it("sin cliente de notificaciones no evalúa nada", async () => {
      const findById = vi.fn().mockResolvedValue(fakeShipment({ status: ShipmentStatus.ASSIGNED }));
      const service = createPositionService(
        fakeShipmentRepository({ findById }),
        fakePositionRepository(),
        createFakeRedis(),
        fakeRealtime()
      );

      await service.reportPosition("shipment-1", "carrier-1", at(NEAR_PICKUP, 0));
      await flush();

      // Solo la lectura del contexto de tracking, ninguna consulta de proximidad.
      expect(findById).toHaveBeenCalledTimes(1);
    });
  });
});
