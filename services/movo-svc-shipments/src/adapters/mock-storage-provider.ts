import { randomUUID } from "node:crypto";
import { StorageProvider } from "./storage-provider";

interface StoredObject {
  contentType: string;
  contentLength: number;
}

const MOCK_DOWNLOAD_URL_HOST = "mock-bucket.s3.mock-region.movo.local";

/**
 * `StorageProvider` de más superficie que la interfaz real -- como nadie hace un PUT
 * real a una presigned URL sintética, los tests de integración usan `__simulateUpload`
 * para marcar un objeto como "ya subido" antes de llamar al endpoint de confirmación.
 * Mismo criterio que el mock de `movo-svc-users` (MOVO-97): la superficie extra es solo
 * para test, nunca la usa código de producción.
 */
export interface MockStorageProvider extends StorageProvider {
  __simulateUpload(key: string, meta: StoredObject): void;
}

/**
 * Implementación de desarrollo (STORAGE_PROVIDER=mock, default): estado en memoria, sin
 * red -- para que toda la suite corra sin credenciales de AWS.
 */
export function createMockStorageProvider(): MockStorageProvider {
  const objects = new Map<string, StoredObject>();

  return {
    async createUploadUrl(input) {
      // No marca el objeto como existente todavía -- recién "existe" cuando el test
      // simula el PUT del cliente con __simulateUpload, igual que en la vida real el
      // objeto no existe hasta que el cliente termina de subirlo a S3.
      return {
        uploadUrl: `https://${MOCK_DOWNLOAD_URL_HOST}/${input.key}?mock-upload=${randomUUID()}`,
        expiresIn: 300,
      };
    },

    async headObject(key) {
      const stored = objects.get(key);
      if (!stored) {
        return { exists: false };
      }
      return { exists: true, contentType: stored.contentType, contentLength: stored.contentLength };
    },

    async createDownloadUrl(key) {
      return {
        url: `https://${MOCK_DOWNLOAD_URL_HOST}/${key}?mock-download=${randomUUID()}`,
        expiresIn: 300,
      };
    },

    async deleteObject(key) {
      objects.delete(key);
    },

    __simulateUpload(key, meta) {
      objects.set(key, meta);
    },
  };
}
