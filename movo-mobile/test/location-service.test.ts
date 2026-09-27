import { ApiError } from "@movo/shared/dist/errors/api-error";
import { LocationService } from "../src/location/location-service";
import { backgroundTrackingManager } from "../src/location/tracking-task";
import { offlineQueueStorage } from "../src/location/offline-queue-storage";

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 1 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

jest.mock("../src/location/tracking-task", () => {
  let droppedCb: ((id: string, reason: string) => void) | null = null;
  return {
    backgroundTrackingManager: {
      setTrackingContext: jest.fn(),
      startBackgroundTracking: jest.fn().mockResolvedValue(true),
      stopBackgroundTracking: jest.fn().mockResolvedValue(undefined),
      flushBatchQueue: jest.fn().mockResolvedValue({ sentCount: 1, remainingCount: 0 }),
      onShipmentDropped: jest.fn((cb) => {
        droppedCb = cb;
        return () => {
          droppedCb = null;
        };
      }),
      __triggerDropped: (id: string, reason: string) => {
        if (droppedCb) droppedCb(id, reason);
      },
    },
  };
});

describe("LocationService (MOVO-203 / MOVO-242)", () => {
  let mockGetForegroundPermissions: jest.Mock;
  let mockGetBackgroundPermissions: jest.Mock;
  let mockGetPosition: jest.Mock;
  let mockReportPosition: jest.Mock;
  let inMemoryQueue: any[];

  beforeEach(() => {
    jest.useFakeTimers();

    inMemoryQueue = [];
    mockGetForegroundPermissions = jest.fn().mockResolvedValue({ granted: true, status: "granted" });
    mockGetBackgroundPermissions = jest.fn().mockResolvedValue({ granted: true, status: "granted" });
    mockGetPosition = jest.fn().mockResolvedValue({
      coords: {
        latitude: -31.4167,
        longitude: -64.1833,
        accuracy: 12.5,
      },
      timestamp: 1727090000000,
    });
    mockReportPosition = jest.fn().mockResolvedValue({ persisted: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  function createService(options?: { intervalMs?: number }) {
    return new LocationService({
      location: {
        getForegroundPermissionsAsync: mockGetForegroundPermissions,
        getBackgroundPermissionsAsync: mockGetBackgroundPermissions,
        getCurrentPositionAsync: mockGetPosition,
      },
      client: {
        reportPosition: mockReportPosition,
      },
      storage: {
        loadQueue: jest.fn().mockImplementation(async () => [...inMemoryQueue]),
        saveQueue: jest.fn().mockImplementation(async (q) => {
          inMemoryQueue = [...q];
        }),
        enqueuePositions: jest.fn().mockImplementation(async (positions) => {
          inMemoryQueue.push(...positions);
          return inMemoryQueue;
        }),
        clearQueue: jest.fn().mockImplementation(async () => {
          inMemoryQueue = [];
        }),
      },
      options: {
        intervalMs: options?.intervalMs ?? 25_000,
      },
    });
  }

  it("inicia tracking para un viaje y realiza captura inmediata (AC1, AC2)", async () => {
    const service = createService();

    await service.startTracking({ tripId: "trip-1", shipmentIds: ["shipment-1"] });

    expect(service.getStatus().isTracking).toBe(true);
    expect(service.getStatus().tripId).toBe("trip-1");
    expect(service.getStatus().activeShipmentIds).toEqual(["shipment-1"]);

    await Promise.resolve();

    expect(mockGetForegroundPermissions).toHaveBeenCalled();
    expect(mockGetPosition).toHaveBeenCalled();
    expect(backgroundTrackingManager.setTrackingContext).toHaveBeenCalledWith("trip-1", ["shipment-1"]);
    expect(backgroundTrackingManager.startBackgroundTracking).toHaveBeenCalledWith("trip-1", ["shipment-1"]);

    await service.stopTracking();
  });

  it("emite posiciones periódicamente en foreground según el intervalo configurado (AC2)", async () => {
    const service = createService({ intervalMs: 25_000 });

    await service.startTracking(["shipment-1"]);
    await Promise.resolve();
    expect(mockGetPosition).toHaveBeenCalledTimes(1);

    // Avanzar 25 segundos
    await jest.advanceTimersByTimeAsync(25_000);
    expect(mockGetPosition).toHaveBeenCalledTimes(2);

    await service.stopTracking();
  });

  it("detiene el tracking inmediatamente y desregistra background (AC5, AC7, AC11)", async () => {
    const service = createService({ intervalMs: 25_000 });

    await service.startTracking(["shipment-1"]);
    await Promise.resolve();
    expect(service.getStatus().isTracking).toBe(true);

    await service.stopTracking();
    expect(service.getStatus().isTracking).toBe(false);
    expect(service.getStatus().activeShipmentIds).toEqual([]);
    expect(backgroundTrackingManager.stopBackgroundTracking).toHaveBeenCalled();
  });

  it("registra error cuando los permisos de foreground no fueron concedidos", async () => {
    mockGetForegroundPermissions.mockResolvedValueOnce({ granted: false, status: "denied" });
    const service = createService();

    await service.startTracking(["shipment-1"]);
    await Promise.resolve();

    expect(service.getStatus().lastError).toBe("PERMISSION_DENIED");
    expect(mockGetPosition).not.toHaveBeenCalled();

    await service.stopTracking();
  });

  it("permite tracking solo en foreground si el permiso de background fue denegado (AC3)", async () => {
    mockGetForegroundPermissions.mockResolvedValue({ granted: true, status: "granted" });
    mockGetBackgroundPermissions.mockResolvedValue({ granted: false, status: "denied" });

    const service = createService();
    await service.checkBackgroundPermission();

    await service.startTracking(["shipment-1"]);
    await Promise.resolve();

    const status = service.getStatus();
    expect(status.isTracking).toBe(true);
    expect(status.isForegroundOnly).toBe(true);
    expect(status.isBackgroundActive).toBe(false);

    await service.stopTracking();
  });

  it("desvincula un envío individual cuando backgroundManager notifica SHIPMENT_NOT_TRACKABLE", async () => {
    const service = createService();
    await service.startTracking(["shipment-1", "shipment-2"]);

    expect(service.getStatus().activeShipmentIds).toEqual(["shipment-1", "shipment-2"]);

    // Disparar evento de descarte por SHIPMENT_NOT_TRACKABLE (MOVO-251 / AC7)
    (backgroundTrackingManager as any).__triggerDropped("shipment-2", "SHIPMENT_NOT_TRACKABLE");

    expect(service.getStatus().activeShipmentIds).toEqual(["shipment-1"]);
    expect(service.getStatus().isTracking).toBe(true);

    // Si se descarta el último envío, se frena el tracking
    (backgroundTrackingManager as any).__triggerDropped("shipment-1", "SHIPMENT_NOT_TRACKABLE");
    expect(service.getStatus().isTracking).toBe(false);
    expect(service.getStatus().activeShipmentIds).toEqual([]);
  });

  it("updateActiveShipments detiene el tracking si la lista queda vacía", async () => {
    const service = createService();
    await service.startTracking(["shipment-1"]);
    expect(service.getStatus().isTracking).toBe(true);

    await service.updateActiveShipments([]);
    expect(service.getStatus().isTracking).toBe(false);
  });

  it("en modo simulación, updateActiveShipments no detiene el tracking", async () => {
    const service = createService();
    service.setSimulationMode(true);
    await service.startTracking(["ship-simulated"]);

    expect(service.getStatus().isTracking).toBe(true);

    await service.updateActiveShipments([]);
    expect(service.getStatus().isTracking).toBe(true);

    service.setSimulationMode(false);
    await service.stopTracking();
    expect(service.getStatus().isTracking).toBe(false);
  });
});
