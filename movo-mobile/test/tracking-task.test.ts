import {
  backgroundTrackingManager,
  MOVO_CARRIER_BACKGROUND_TRACKING_TASK,
  MAX_POSITIONS_PER_BATCH,
} from "../src/location/tracking-task";
import { offlineQueueStorage, QueuedPosition } from "../src/location/offline-queue-storage";
import { shipmentsClient } from "../src/api/shipments-client";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { ApiError } from "@movo/shared/dist/errors/api-error";

jest.mock("expo-task-manager", () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(),
}));

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));

jest.mock("../src/location/offline-queue-storage", () => ({
  offlineQueueStorage: {
    loadQueue: jest.fn(),
    saveQueue: jest.fn(),
    enqueuePositions: jest.fn(),
    removeSentPositions: jest.fn().mockResolvedValue([]),
    clearQueue: jest.fn(),
    saveTrackingContext: jest.fn().mockResolvedValue(undefined),
    loadTrackingContext: jest.fn().mockResolvedValue(null),
    clearTrackingContext: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../src/api/shipments-client", () => ({
  shipmentsClient: {
    reportPositionsBatch: jest.fn(),
  },
}));

describe("BackgroundTrackingManager (MOVO-242 / AC1, AC5, AC8)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    backgroundTrackingManager.setTrackingContext("trip-1", ["shipment-1"]);
  });

  it("handleLocations encola las posiciones para todos los envíos activos y llama a flushBatchQueue", async () => {
    const locations = [
      {
        coords: { latitude: -31.42, longitude: -64.18, accuracy: 10 },
        timestamp: 1727340000000,
      },
    ] as Location.LocationObject[];

    (offlineQueueStorage.loadQueue as jest.Mock).mockResolvedValue([]);
    (offlineQueueStorage.enqueuePositions as jest.Mock).mockResolvedValue([]);

    await backgroundTrackingManager.handleLocations(locations);

    expect(offlineQueueStorage.enqueuePositions).toHaveBeenCalledWith([
      {
        shipmentId: "shipment-1",
        lat: -31.42,
        lng: -64.18,
        accuracyM: 10,
        capturedAt: new Date(1727340000000).toISOString(),
      },
    ]);
  });

  it("flushBatchQueue envía lotes de hasta 100 posiciones y procesa respuestas accepted y rejected", async () => {
    backgroundTrackingManager.setTrackingContext("trip-1", ["shipment-1", "shipment-2"]);
    const queue: QueuedPosition[] = [
      { shipmentId: "shipment-1", lat: 1, lng: 1, accuracyM: 5, capturedAt: "2026-09-26T10:00:00Z" },
      { shipmentId: "shipment-2", lat: 2, lng: 2, accuracyM: 5, capturedAt: "2026-09-26T10:00:01Z" },
    ];
    (offlineQueueStorage.loadQueue as jest.Mock).mockResolvedValue(queue);
    (shipmentsClient.reportPositionsBatch as jest.Mock).mockResolvedValue({
      results: [
        { index: 0, shipmentId: "shipment-1", status: "accepted", persisted: true },
        { index: 1, shipmentId: "shipment-2", status: "rejected", code: "SHIPMENT_NOT_TRACKABLE" },
      ],
    });

    const dropListener = jest.fn();
    const unsub = backgroundTrackingManager.onShipmentDropped(dropListener);

    const result = await backgroundTrackingManager.flushBatchQueue();

    expect(shipmentsClient.reportPositionsBatch).toHaveBeenCalledWith(
      queue.map((item) => ({
        shipmentId: item.shipmentId,
        lat: item.lat,
        lng: item.lng,
        accuracyM: item.accuracyM,
        capturedAt: item.capturedAt,
      }))
    );

    // Ambas posiciones salen de la cola de forma segura (una aceptada, otra rechazada terminal)
    expect(offlineQueueStorage.removeSentPositions).toHaveBeenCalledWith(queue);
    expect(result.sentCount).toBe(2);

    // shipment-2 se desvincula de los envíos activos por SHIPMENT_NOT_TRACKABLE
    expect(dropListener).toHaveBeenCalledWith("shipment-2", "SHIPMENT_NOT_TRACKABLE");
    expect(backgroundTrackingManager.getTrackingContext().shipmentIds).toEqual(["shipment-1"]);

    unsub();
  });

  it("handleLocations restaura el contexto persistido si el proceso fue relanzado headless (MOVO-242)", async () => {
    // Simular que el proceso fue reiniciado en background sin UI: memoria vacía
    backgroundTrackingManager.setTrackingContext(null, []);
    expect(backgroundTrackingManager.getTrackingContext().shipmentIds).toEqual([]);

    // En disco existe el contexto guardado previamente
    (offlineQueueStorage.loadTrackingContext as jest.Mock).mockResolvedValue({
      tripId: "persisted-trip-123",
      shipmentIds: ["persisted-shipment-456"],
    });
    (offlineQueueStorage.loadQueue as jest.Mock).mockResolvedValue([]);
    (offlineQueueStorage.enqueuePositions as jest.Mock).mockResolvedValue([]);

    const locations = [
      {
        coords: { latitude: -31.42, longitude: -64.18, accuracy: 10 },
        timestamp: 1727340000000,
      },
    ] as Location.LocationObject[];

    await backgroundTrackingManager.handleLocations(locations);

    expect(offlineQueueStorage.loadTrackingContext).toHaveBeenCalled();
    expect(backgroundTrackingManager.getTrackingContext()).toEqual({
      tripId: "persisted-trip-123",
      shipmentIds: ["persisted-shipment-456"],
    });
    expect(offlineQueueStorage.enqueuePositions).toHaveBeenCalledWith([
      expect.objectContaining({ shipmentId: "persisted-shipment-456" }),
    ]);
  });

  it("flushBatchQueue retiene la cola y no descarta posiciones ante HTTP 429", async () => {
    const queue: QueuedPosition[] = [
      { shipmentId: "shipment-1", lat: 1, lng: 1, accuracyM: 5, capturedAt: "2026-09-26T10:00:00Z" },
    ];
    (offlineQueueStorage.loadQueue as jest.Mock).mockResolvedValue(queue);
    (shipmentsClient.reportPositionsBatch as jest.Mock).mockRejectedValue(
      new ApiError(429, "RATE_LIMIT_EXCEEDED", "Rate limit")
    );

    const result = await backgroundTrackingManager.flushBatchQueue();

    expect(result.sentCount).toBe(0);
    expect(result.remainingCount).toBe(1);
    // saveQueue no se llama para vaciar
    expect(offlineQueueStorage.saveQueue).not.toHaveBeenCalled();
  });

  it("startBackgroundTracking inicia location updates si los permisos están concedidos", async () => {
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValue(false);

    const started = await backgroundTrackingManager.startBackgroundTracking("trip-1", ["shipment-1"]);

    expect(started).toBe(true);
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      MOVO_CARRIER_BACKGROUND_TRACKING_TASK,
      expect.objectContaining({
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 45_000,
        distanceInterval: 30,
      })
    );
  });

  it("startBackgroundTracking devuelve false si falta permiso de background", async () => {
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });

    const started = await backgroundTrackingManager.startBackgroundTracking("trip-1", ["shipment-1"]);

    expect(started).toBe(false);
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it("stopBackgroundTracking detiene la tarea y limpia el contexto", async () => {
    (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValue(true);
    (offlineQueueStorage.loadQueue as jest.Mock).mockResolvedValue([]);

    await backgroundTrackingManager.stopBackgroundTracking();

    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(MOVO_CARRIER_BACKGROUND_TRACKING_TASK);
    expect(backgroundTrackingManager.getTrackingContext()).toEqual({
      tripId: null,
      shipmentIds: [],
    });
  });
});
