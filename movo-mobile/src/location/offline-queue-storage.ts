import * as FileSystem from "expo-file-system";
import { secureStore, SECURE_STORE_KEYS } from "../lib/secure-store";

export interface QueuedPosition {
  shipmentId: string;
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: string; // ISO-8601
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
  private hasMigratedLegacy = false;

  constructor(deps?: OfflineQueueStorageDeps) {
    this.fs = deps?.fs ?? (FileSystem as unknown as FileSystemAdapter);
    this.legacyStorage = deps?.legacyStorage ?? secureStore;
    const baseDir = this.fs.documentDirectory ?? "";
    this.filePath = `${baseDir}movo_carrier_location_queue.json`;
  }

  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Carga la cola desde el archivo de sistema.
   * Si es la primera vez y el archivo no existe, migra de forma transparente
   * cualquier cola remanente en SecureStore y la elimina de allí (MOVO-242 / AC9).
   */
  async loadQueue(): Promise<QueuedPosition[]> {
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
              await this.saveQueue(queue);
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

  /**
   * Guarda la cola en el archivo persistente, recortando a MAX_OFFLINE_QUEUE_SIZE.
   */
  async saveQueue(queue: QueuedPosition[]): Promise<void> {
    try {
      const trimmed = queue.slice(-MAX_OFFLINE_QUEUE_SIZE);
      await this.fs.writeAsStringAsync(this.filePath, JSON.stringify(trimmed));
    } catch {
      // Manejo silencioso ante fallas de disco
    }
  }

  /**
   * Encola nuevas posiciones preservando el orden FIFO y el límite máximo.
   */
  async enqueuePositions(newPositions: QueuedPosition[]): Promise<QueuedPosition[]> {
    if (newPositions.length === 0) return this.loadQueue();
    const current = await this.loadQueue();
    const combined = [...current, ...newPositions].slice(-MAX_OFFLINE_QUEUE_SIZE);
    await this.saveQueue(combined);
    return combined;
  }

  /**
   * Limpia toda la cola guardada.
   */
  async clearQueue(): Promise<void> {
    try {
      if (this.fs.deleteAsync) {
        await this.fs.deleteAsync(this.filePath, { idempotent: true });
      } else {
        await this.fs.writeAsStringAsync(this.filePath, JSON.stringify([]));
      }
    } catch {
      await this.saveQueue([]);
    }
  }
}

export const offlineQueueStorage = new OfflineQueueStorage();
