import { createS3StorageProvider } from "./s3-storage-provider";
import { createMockStorageProvider, MockStorageProvider } from "./mock-storage-provider";

/**
 * Interfaz de object storage para fotos de paquete (MOVO-81) -- mismo patrón que
 * `StorageProvider` de `movo-svc-users` (MOVO-97), pero recortada/distinta donde el
 * caso difiere: acá el bucket es privado para el prefijo `shipments/*` (AC8), la key ya
 * se persiste directo en `shipment_photos.s3_key` (no hace falta derivarla de una URL
 * pública), y la lectura es vía presigned GET (`createDownloadUrl`), no una URL estable.
 * No vive en `@movo/shared` -- mismo criterio que `SmsProvider`/`DiditClient`/
 * `GeocodingProvider`/el `StorageProvider` de `svc-users`: cada servicio habla directo
 * con S3 con sus propias credenciales (IAM role de la EC2), sin comunicación
 * cross-servicio para esto.
 */
export interface StorageProvider {
  /**
   * Firma una presigned URL de `PUT` para `key`. `contentType`/`contentLength` viajan
   * firmados dentro de la URL (no solo se validan en el request que la pide) -- sin
   * esto, un cliente podría subir a esa URL un archivo de cualquier tipo/tamaño y la
   * firma lo aceptaría igual (AC3 de MOVO-81).
   */
  createUploadUrl(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<{ uploadUrl: string; expiresIn: number }>;

  /** `HEAD` real contra el objeto -- confirma que existe y su tipo/tamaño reales (AC5). */
  headObject(key: string): Promise<{ exists: boolean; contentType?: string; contentLength?: number }>;

  /** Presigned URL de `GET`, TTL corto -- el bucket es privado para este prefijo (AC7/AC8). */
  createDownloadUrl(key: string): Promise<{ url: string; expiresIn: number }>;

  /** MOVO-124: borra un objeto de S3. Solo lo usa el sweep de fotos huérfanas (nunca el
   * flujo normal de subida/confirmación) -- best-effort, quien llama decide si un fallo
   * acá bloquea algo o solo se loguea. */
  deleteObject(key: string): Promise<void>;
}

export interface StorageProviderConfig {
  STORAGE_PROVIDER: "mock" | "s3";
  S3_BUCKET_NAME?: string;
  S3_REGION?: string;
}

/**
 * Selecciona la implementación según `STORAGE_PROVIDER` (default "mock", mismo
 * criterio que el resto de los adapters con modo real/mock del repo): no depender de un
 * bucket real ni de credenciales de AWS para levantar el servicio en dev/test/CI. Falla
 * rápido al arrancar si se pide "s3" sin bucket/región.
 */
export function createStorageProvider(config: StorageProviderConfig): StorageProvider {
  if (config.STORAGE_PROVIDER === "s3") {
    if (!config.S3_BUCKET_NAME || !config.S3_REGION) {
      throw new Error("STORAGE_PROVIDER=s3 requiere S3_BUCKET_NAME y S3_REGION");
    }
    return createS3StorageProvider({ bucketName: config.S3_BUCKET_NAME, region: config.S3_REGION });
  }
  return createMockStorageProvider();
}

export type { MockStorageProvider };
