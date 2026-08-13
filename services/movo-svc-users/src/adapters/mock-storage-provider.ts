import { randomUUID } from "node:crypto";
import { StorageProvider } from "./storage-provider";

interface StoredObject {
  contentType: string;
  contentLength: number;
}

const MOCK_PUBLIC_URL_HOST = "mock-bucket.s3.mock-region.movo.local";

/**
 * `StorageProvider` de más superficie que la interfaz real -- el único punto donde el
 * mock necesita algo que S3 no tiene: como nadie hace un PUT real a una presigned URL
 * sintética, los tests de integración usan `__simulateUpload` para marcar un objeto
 * como "ya subido" antes de llamar al endpoint de confirmación (mismo criterio que el
 * `SmsProvider` capturado en los tests de OTP: la superficie extra es solo para test,
 * nunca la usa código de producción).
 */
export interface MockStorageProvider extends StorageProvider {
  __simulateUpload(key: string, meta: StoredObject): void;
}

/**
 * Implementación de desarrollo (STORAGE_PROVIDER=mock, default): estado en memoria, sin
 * red -- mismo criterio que `MockDiditClient`/`ConsoleSmsProvider`/
 * `MockGeocodingProvider`, para que toda la suite corra sin credenciales de AWS.
 */
export function createMockStorageProvider(): MockStorageProvider {
  const objects = new Map<string, StoredObject>();

  return {
    async createUploadUrl(input) {
      // No marca el objeto como existente todavía -- recién "existe" cuando el test
      // simula el PUT del cliente con __simulateUpload, igual que en la vida real el
      // objeto no existe hasta que el cliente termina de subirlo a S3.
      return {
        uploadUrl: `https://${MOCK_PUBLIC_URL_HOST}/${input.key}?mock-upload=${randomUUID()}`,
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

    getPublicUrl(key) {
      return `https://${MOCK_PUBLIC_URL_HOST}/${key}`;
    },

    getKeyFromUrl(url) {
      try {
        const parsed = new URL(url);
        if (parsed.hostname !== MOCK_PUBLIC_URL_HOST) {
          return null;
        }
        return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
      } catch {
        return null;
      }
    },

    async deleteObject(key) {
      objects.delete(key);
    },

    __simulateUpload(key, meta) {
      objects.set(key, meta);
    },
  };
}
