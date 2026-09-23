import { ApiError } from "@movo/shared/dist/errors/api-error";
import { LocationService } from "../src/location/location-service";
import { SECURE_STORE_KEYS } from "../src/lib/secure-store";

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 1 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

describe("LocationService (MOVO-203)", () => {
  let mockGetPermissions: jest.Mock;
  let mockGetPosition: jest.Mock;
  let mockReportPosition: jest.Mock;
  let mockStorageGet: jest.Mock;
  let mockStorageSet: jest.Mock;
  let mockStorageDelete: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();

    mockGetPermissions = jest.fn().mockResolvedValue({ granted: true, status: "granted" });
    mockGetPosition = jest.fn().mockResolvedValue({
      coords: {
        latitude: -31.4167,
        longitude: -64.1833,
        accuracy: 12.5,
      },
      timestamp: 1727090000000,
    });
    mockReportPosition = jest.fn().mockResolvedValue({ persisted: true });
    mockStorageGet = jest.fn().mockResolvedValue(null);
    mockStorageSet = jest.fn().mockResolvedValue(undefined);
    mockStorageDelete = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  function createService(options?: { intervalMs?: number }) {
    return new LocationService({
      location: {
        getForegroundPermissionsAsync: mockGetPermissions,
        getCurrentPositionAsync: mockGetPosition,
      },
      client: {
        reportPosition: mockReportPosition,
      },
      storage: {
        getItem: mockStorageGet,
        setItem: mockStorageSet,
        deleteItem: mockStorageDelete,
      },
      options: {
        intervalMs: options?.intervalMs ?? 25_000,
      },
    });
  }

  it("inicia tracking y realiza reporte inmediato para envíos activos (AC1, AC2)", async () => {
    const service = createService();

    await service.startTracking(["shipment-1"]);

    expect(service.getStatus().isTracking).toBe(true);
    expect(service.getStatus().activeShipmentIds).toEqual(["shipment-1"]);

    // Esperar a que resuelva la captura inicial asíncrona
    await Promise.resolve();

    expect(mockGetPermissions).toHaveBeenCalled();
    expect(mockGetPosition).toHaveBeenCalled();
    expect(mockReportPosition).toHaveBeenCalledWith("shipment-1", {
      lat: -31.4167,
      lng: -64.1833,
      accuracyM: 12.5,
      capturedAt: new Date(1727090000000).toISOString(),
    });

    await service.stopTracking();
  });

  it("emite posiciones periódicamente según el intervalo configurado (AC2)", async () => {
    const service = createService({ intervalMs: 25_000 });

    await service.startTracking(["shipment-1"]);
    await Promise.resolve();
    expect(mockReportPosition).toHaveBeenCalledTimes(1);

    // Avanzar 25 segundos
    await jest.advanceTimersByTimeAsync(25_000);
    expect(mockReportPosition).toHaveBeenCalledTimes(2);

    // Avanzar otros 25 segundos
    await jest.advanceTimersByTimeAsync(25_000);
    expect(mockReportPosition).toHaveBeenCalledTimes(3);

    await service.stopTracking();
  });

  it("detiene el tracking inmediatamente y limpia el timer (AC5, AC7)", async () => {
    const service = createService({ intervalMs: 25_000 });

    await service.startTracking(["shipment-1"]);
    await Promise.resolve();
    expect(service.getStatus().isTracking).toBe(true);

    await service.stopTracking();
    expect(service.getStatus().isTracking).toBe(false);
    expect(service.getStatus().activeShipmentIds).toEqual([]);

    // Avanzar el tiempo: no debe haber más llamadas
    jest.advanceTimersByTime(50_000);
    await Promise.resolve();
    expect(mockReportPosition).toHaveBeenCalledTimes(1);
  });

  it("registra error cuando los permisos no fueron concedidos (AC4, AC5)", async () => {
    mockGetPermissions.mockResolvedValueOnce({ granted: false, status: "denied" });
    const service = createService();

    await service.startTracking(["shipment-1"]);
    await Promise.resolve();

    expect(service.getStatus().lastError).toBe("PERMISSION_DENIED");
    expect(mockGetPosition).not.toHaveBeenCalled();
    expect(mockReportPosition).not.toHaveBeenCalled();

    await service.stopTracking();
  });

  it("encola posiciones offline cuando hay fallo de red preservando capturedAt (AC6)", async () => {
    mockReportPosition.mockRejectedValueOnce(new Error("Network request failed"));
    const service = createService();

    await service.startTracking(["shipment-1"]);
    await Promise.resolve();

    const status = service.getStatus();
    expect(status.pendingQueueCount).toBe(1);

    const queue = service.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toEqual({
      shipmentId: "shipment-1",
      lat: -31.4167,
      lng: -64.1833,
      accuracyM: 12.5,
      capturedAt: new Date(1727090000000).toISOString(),
    });

    expect(mockStorageSet).toHaveBeenCalledWith(
      SECURE_STORE_KEYS.carrierLocationOfflineQueue,
      expect.stringContaining("shipment-1")
    );

    await service.stopTracking();
  });

  it("no encola errores terminales 403 o 404 (envío ya no en tránsito)", async () => {
    mockReportPosition.mockRejectedValueOnce(
      new ApiError(403, "SHIPMENT_NOT_IN_TRANSIT", "El envío ya no está en tránsito")
    );
    const service = createService();

    await service.startTracking(["shipment-1"]);
    await Promise.resolve();

    expect(service.getStatus().pendingQueueCount).toBe(0);
    expect(mockStorageSet).not.toHaveBeenCalled();

    await service.stopTracking();
  });

  it("drena la cola offline enviando muestras con su capturedAt original al recuperar red (AC6)", async () => {
    const service = createService();

    // 1. Simular fallo inicial para encolar
    mockReportPosition.mockRejectedValueOnce(new Error("Network error"));
    await service.startTracking(["shipment-1"]);
    await Promise.resolve();
    expect(service.getStatus().pendingQueueCount).toBe(1);

    // 2. Siguiente tick con red disponible
    mockReportPosition.mockResolvedValue({ persisted: true });
    await jest.advanceTimersByTimeAsync(25_000);

    // Debe haberse reportado la posición actual y luego drenado la encolada
    expect(mockReportPosition).toHaveBeenCalledWith(
      "shipment-1",
      expect.objectContaining({
        capturedAt: new Date(1727090000000).toISOString(),
      })
    );

    expect(service.getStatus().pendingQueueCount).toBe(0);
    expect(mockStorageDelete).toHaveBeenCalledWith(SECURE_STORE_KEYS.carrierLocationOfflineQueue);

    await service.stopTracking();
  });

  it("recupera la cola persistida desde storage al iniciar", async () => {
    const persistedItems = [
      {
        shipmentId: "shipment-saved",
        lat: -31.42,
        lng: -64.19,
        accuracyM: 10,
        capturedAt: "2026-09-23T10:00:00.000Z",
      },
    ];
    mockStorageGet.mockResolvedValueOnce(JSON.stringify(persistedItems));

    const service = createService();
    await service.loadPersistedQueue();

    expect(service.getStatus().pendingQueueCount).toBe(1);
    expect(service.getQueue()[0].shipmentId).toBe("shipment-saved");
  });

  it("updateActiveShipments detiene el tracking si la lista queda vacía", async () => {
    const service = createService();
    await service.startTracking(["shipment-1"]);
    expect(service.getStatus().isTracking).toBe(true);

    await service.updateActiveShipments([]);
    expect(service.getStatus().isTracking).toBe(false);
  });

  it("checkPermission y requestPermission sincronizan el estado permissionGranted y notifican", async () => {
    const service = createService();
    const statusListener = jest.fn();
    service.subscribe(statusListener);

    // Initial state
    expect(service.getStatus().permissionGranted).toBe(null);

    // Check permission granted
    const granted = await service.checkPermission();
    expect(granted).toBe(true);
    expect(service.getStatus().permissionGranted).toBe(true);
    expect(statusListener).toHaveBeenCalledWith(expect.objectContaining({ permissionGranted: true }));

    // Request permission denied
    mockGetPermissions.mockResolvedValueOnce({ granted: false, status: "denied" });
    const denied = await service.checkPermission();
    expect(denied).toBe(false);
    expect(service.getStatus().permissionGranted).toBe(false);
    expect(service.getStatus().lastError).toBe("PERMISSION_DENIED");
  });
});
