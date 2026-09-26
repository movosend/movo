import * as FileSystem from "expo-file-system/legacy";
import { secureStore, SECURE_STORE_KEYS } from "../lib/secure-store";

export interface QueuedPosition {
  shipmentId: string;
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: string; // ISO-8601
}

export interface TrackingContextData {
  tripId: string | null;
  shipmentIds: string[];
}

export const MAX_OFFLINE_QUEUE_SIZE = 100;

export interface FileSystemAdapter {
  getInfoAsync: (fileUri: string) => Promise<{ exists: boolean }>;
  readAsStringAsync: (fileUri: string) => Promise<string>;
  writeAsStringAsync: (fileUri: string, contents: string) => Promise<void>;
  deleteAsync?: (fileUri: string, options?: { idempotent?: boolean }) => Promise<void>;
  documentDirectory: string | null;
}

export interface OfflineQueueStorageDeps {
  fs?: FileSystemAdapter;
  legacyStorage?: {
    getItem: (key: string) => Promise<string | null>;
    deleteItem: (key: string) => Promise<void>;
  };
}

export class OfflineQueueStorage {
  private readonly fs: FileSystemAdapter;
  private readonly legacyStorage: OfflineQueueStorageDeps["legacyStorage"];
  private readonly filePath: string;
  private readonly contextFilePath: string;
  private hasMigratedLegacy = false;
  private ioMutex = Promise.resolve();

  constructor(deps?: OfflineQueueStorageDeps) {
    this.fs = deps?.fs ?? (FileSystem as unknown as FileSystemAdapter);
    this.legacyStorage = deps?.legacyStorage ?? secureStore;
    const baseDir = this.fs.documentDirectory ?? "";
    this.filePath = `${baseDir}movo_carrier_location_queue.json`;
    this.contextFilePath = `${baseDir}movo_carrier_tracking_context.json`;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getContextFilePath(): string {
    return this.contextFilePath;
  }

  /**
   * Serializa operaciones de I/O en archivo para evitar carreras entre foreground y background.
   */
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.ioMutex.then(operation, operation);
    this.ioMutex = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  private async readQueueFromFile(): Promise<QueuedPosition[]> {
    try {
      const info = await this.fs.getInfoAsync(this.filePath);
      if (info.exists) {
        const raw = await this.fs.readAsStringAsync(this.filePath);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.slice(-MAX_OFFLINE_QUEUE_SIZE);
        }
        return [];
      }

      // Migración desde expo-secure-store si aún no se realizó
      if (!this.hasMigratedLegacy && this.legacyStorage) {
        this.hasMigratedLegacy = true;
        const legacyRaw = await this.legacyStorage.getItem(
          SECURE_STORE_KEYS.carrierLocationOfflineQueue
        );
        if (legacyRaw) {
          try {
            const legacyParsed = JSON.parse(legacyRaw);
            if (Array.isArray(legacyParsed) && legacyParsed.length > 0) {
              const queue = legacyParsed.slice(-MAX_OFFLINE_QUEUE_SIZE);
              await this.writeQueueToFile(queue);
              await this.legacyStorage.deleteItem(
                SECURE_STORE_KEYS.carrierLocationOfflineQueue
              );
              return queue;
            }
          } catch {
            // Ignorar formato inválido en legacy
          }
        }
      }

      return [];
    } catch {
      return [];
    }
  }

  private async writeQueueToFile(queue: QueuedPosition[]): Promise<void> {
    try {
      const trimmed = queue.slice(-MAX_OFFLINE_QUEUE_SIZE);
      await this.fs.writeAsStringAsync(this.filePath, JSON.stringify(trimmed));
    } catch {
      // Manejo silencioso ante fallas de disco
    }
  }

  /**
   * Carga la cola desde el archivo de sistema de manera segura.
   */
  async loadQueue(): Promise<QueuedPosition[]> {
    return this.withLock(() => this.readQueueFromFile());
  }

  /**
   * Guarda la cola en el archivo persistente, recortando a MAX_OFFLINE_QUEUE_SIZE.
   */
  async saveQueue(queue: QueuedPosition[]): Promise<void> {
    return this.withLock(() => this.writeQueueToFile(queue));
  }

  /**
   * Encola nuevas posiciones preservando el orden FIFO y el límite máximo bajo mutex.
   */
  async enqueuePositions(newPositions: QueuedPosition[]): Promise<QueuedPosition[]> {
    if (newPositions.length === 0) return this.loadQueue();
    return this.withLock(async () => {
      const current = await this.readQueueFromFile();
      const combined = [...current, ...newPositions].slice(-MAX_OFFLINE_QUEUE_SIZE);
      await this.writeQueueToFile(combined);
      return combined;
    });
  }

  /**
   * Quita de la cola las posiciones enviadas o descartadas.
   * Relee la cola actual del disco para no pisar posiciones encoladas concurrentemente
   * durante el viaje de red (evita lost updates).
   */
  async removeSentPositions(itemsToRemove: QueuedPosition[]): Promise<QueuedPosition[]> {
    if (itemsToRemove.length === 0) return this.loadQueue();
    return this.withLock(async () => {
      const current = await this.readQueueFromFile();
      const removeKeys = new Set(
        itemsToRemove.map((item) => `${item.shipmentId}#${item.capturedAt}`)
      );
      const remaining = current.filter(
        (item) => !removeKeys.has(`${item.shipmentId}#${item.capturedAt}`)
      );
      await this.writeQueueToFile(remaining);
      return remaining;
    });
  }

  /**
   * Limpia toda la cola guardada bajo mutex.
   */
  async clearQueue(): Promise<void> {
    return this.withLock(async () => {
      try {
        if (this.fs.deleteAsync) {
          await this.fs.deleteAsync(this.filePath, { idempotent: true });
        } else {
          await this.fs.writeAsStringAsync(this.filePath, JSON.stringify([]));
        }
      } catch {
        await this.writeQueueToFile([]);
      }
    });
  }

  /**
   * Persiste el contexto de tracking en disco para que la tarea headless pueda
   * recuperarlo ante un reinicio del proceso en segundo plano (MOVO-242).
   */
  async saveTrackingContext(context: TrackingContextData): Promise<void> {
    return this.withLock(async () => {
      try {
        await this.fs.writeAsStringAsync(this.contextFilePath, JSON.stringify(context));
      } catch {
        // Ignorar fallas de I/O
      }
    });
  }

  /**
   * Carga el contexto de tracking persistido en disco.
   */
  async loadTrackingContext(): Promise<TrackingContextData | null> {
    return this.withLock(async () => {
      try {
        const info = await this.fs.getInfoAsync(this.contextFilePath);
        if (!info.exists) return null;
        const raw = await this.fs.readAsStringAsync(this.contextFilePath);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as TrackingContextData;
        if (parsed && Array.isArray(parsed.shipmentIds)) {
          return parsed;
        }
        return null;
      } catch {
        return null;
      }
    });
  }

  /**
   * Limpia el contexto de tracking en disco al detener el viaje.
   */
  async clearTrackingContext(): Promise<void> {
    return this.withLock(async () => {
      try {
        if (this.fs.deleteAsync) {
          await this.fs.deleteAsync(this.contextFilePath, { idempotent: true });
        } else {
          await this.fs.writeAsStringAsync(
            this.contextFilePath,
            JSON.stringify({ tripId: null, shipmentIds: [] })
          );
        }
      } catch {
        // Ignorar
      }
    });
  }
}

export const offlineQueueStorage = new OfflineQueueStorage();
