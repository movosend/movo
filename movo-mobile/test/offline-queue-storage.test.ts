import { OfflineQueueStorage, QueuedPosition, MAX_OFFLINE_QUEUE_SIZE } from "../src/location/offline-queue-storage";
import { SECURE_STORE_KEYS } from "../src/lib/secure-store";

describe("OfflineQueueStorage (MOVO-242 / AC9)", () => {
  let mockGetInfoAsync: jest.Mock;
  let mockReadAsStringAsync: jest.Mock;
  let mockWriteAsStringAsync: jest.Mock;
  let mockDeleteAsync: jest.Mock;
  let mockLegacyGetItem: jest.Mock;
  let mockLegacyDeleteItem: jest.Mock;

  const mockFs = {
    getInfoAsync: jest.fn(),
    readAsStringAsync: jest.fn(),
    writeAsStringAsync: jest.fn(),
    deleteAsync: jest.fn(),
    documentDirectory: "file:///mock/data/",
  };

  const mockLegacyStorage = {
    getItem: jest.fn(),
    deleteItem: jest.fn(),
  };

  function createStorage() {
    return new OfflineQueueStorage({
      fs: mockFs,
      legacyStorage: mockLegacyStorage,
    });
  }

  beforeEach(() => {
    mockGetInfoAsync = mockFs.getInfoAsync;
    mockReadAsStringAsync = mockFs.readAsStringAsync;
    mockWriteAsStringAsync = mockFs.writeAsStringAsync;
    mockDeleteAsync = mockFs.deleteAsync;
    mockLegacyGetItem = mockLegacyStorage.getItem;
    mockLegacyDeleteItem = mockLegacyStorage.deleteItem;

    jest.clearAllMocks();
  });

  it("devuelve array vacío si el archivo no existe y no hay legacy data", async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: false });
    mockLegacyGetItem.mockResolvedValue(null);

    const storage = createStorage();
    const queue = await storage.loadQueue();

    expect(queue).toEqual([]);
    expect(mockGetInfoAsync).toHaveBeenCalledWith("file:///mock/data/movo_carrier_location_queue.json");
  });

  it("migra automáticamente los datos de SecureStore si el archivo no existe (AC9)", async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: false });
    const legacyPositions: QueuedPosition[] = [
      { shipmentId: "s1", lat: -31.4, lng: -64.1, accuracyM: 10, capturedAt: "2026-09-26T10:00:00Z" },
    ];
    mockLegacyGetItem.mockResolvedValue(JSON.stringify(legacyPositions));
    mockWriteAsStringAsync.mockResolvedValue(undefined);
    mockLegacyDeleteItem.mockResolvedValue(undefined);

    const storage = createStorage();
    const queue = await storage.loadQueue();

    expect(queue).toEqual(legacyPositions);
    expect(mockWriteAsStringAsync).toHaveBeenCalledWith(
      "file:///mock/data/movo_carrier_location_queue.json",
      JSON.stringify(legacyPositions)
    );
    expect(mockLegacyDeleteItem).toHaveBeenCalledWith(SECURE_STORE_KEYS.carrierLocationOfflineQueue);
  });

  it("lee y parsea la cola existente del archivo si ya existe", async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true });
    const storedPositions: QueuedPosition[] = [
      { shipmentId: "s1", lat: -31.4, lng: -64.1, accuracyM: 10, capturedAt: "2026-09-26T10:00:00Z" },
    ];
    mockReadAsStringAsync.mockResolvedValue(JSON.stringify(storedPositions));

    const storage = createStorage();
    const queue = await storage.loadQueue();

    expect(queue).toEqual(storedPositions);
    expect(mockLegacyGetItem).not.toHaveBeenCalled();
  });

  it("encola posiciones nuevas respetando el límite FIFO de MAX_OFFLINE_QUEUE_SIZE", async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true });
    // Simulamos 99 posiciones existentes
    const existing: QueuedPosition[] = Array.from({ length: 99 }, (_, i) => ({
      shipmentId: `s-${i}`,
      lat: 1,
      lng: 1,
      accuracyM: 5,
      capturedAt: `2026-09-26T10:00:${i < 10 ? "0" + i : i}Z`,
    }));
    mockReadAsStringAsync.mockResolvedValue(JSON.stringify(existing));
    mockWriteAsStringAsync.mockResolvedValue(undefined);

    const storage = createStorage();
    const newItems: QueuedPosition[] = [
      { shipmentId: "new-1", lat: 2, lng: 2, accuracyM: 5, capturedAt: "2026-09-26T10:01:00Z" },
      { shipmentId: "new-2", lat: 2, lng: 2, accuracyM: 5, capturedAt: "2026-09-26T10:01:01Z" },
    ];

    const result = await storage.enqueuePositions(newItems);

    expect(result.length).toBe(MAX_OFFLINE_QUEUE_SIZE);
    // La primera posición original (s-0) debe haber sido descartada (FIFO)
    expect(result[0].shipmentId).toBe("s-1");
    expect(result[result.length - 1].shipmentId).toBe("new-2");
    expect(mockWriteAsStringAsync).toHaveBeenCalledWith(
      "file:///mock/data/movo_carrier_location_queue.json",
      JSON.stringify(result)
    );
  });

  it("clearQueue borra el archivo de la cola", async () => {
    mockDeleteAsync.mockResolvedValue(undefined);

    const storage = createStorage();
    await storage.clearQueue();

    expect(mockDeleteAsync).toHaveBeenCalledWith(
      "file:///mock/data/movo_carrier_location_queue.json",
      { idempotent: true }
    );
  });
});
