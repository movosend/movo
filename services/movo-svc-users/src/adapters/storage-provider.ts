import { createS3StorageProvider } from "./s3-storage-provider";
import { createMockStorageProvider, MockStorageProvider } from "./mock-storage-provider";

/**
 * Interfaz genérica de object storage (ADR-007, primera implementación real: MOVO-97).
 * No habla de "foto de perfil" a propósito -- vive solo en `services/movo-svc-users`
 * (mismo criterio que `SmsProvider`/`DiditClient`/`GeocodingProvider`, ninguno vive en
 * `@movo/shared`), pero el contrato está pensado para que `svc-shipments` (MOVO-81,
 * fotos de paquete) y `svc-admin` (evidencia de disputas) copien el mismo patrón a su
 * propia carpeta `src/adapters/` cuando les toque -- no hay comunicación entre
 * servicios acá, cada uno habla directo con S3 con sus propias credenciales (IAM role
 * de la EC2).
 */
export interface StorageProvider {
  /**
   * Firma una presigned URL de `PUT` para `key`. `contentType`/`contentLength` viajan
   * como headers firmados dentro de la URL (no solo se validan en el request que la
   * pide) -- sin esto, un cliente podría subir a esa URL un archivo de cualquier tipo/
   * tamaño y la firma lo aceptaría igual (AC2 de MOVO-97).
   */
  createUploadUrl(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<{ uploadUrl: string; expiresIn: number }>;

  /** `HEAD` real contra el objeto -- confirma que existe y su tipo/tamaño reales. */
  headObject(key: string): Promise<{ exists: boolean; contentType?: string; contentLength?: number }>;

  /** URL pública y estable del objeto (bucket/prefijo de lectura pública). */
  getPublicUrl(key: string): string;

  /**
   * Inversa de `getPublicUrl` -- recupera la key a partir de una URL ya persistida.
   * Hace falta porque no se guarda el `objectKey` en una columna aparte (MOVO-97 no
   * migra el schema): al reemplazar una foto, la key del objeto viejo se deriva de la
   * URL guardada en `photo_url`. Vive acá junto a `getPublicUrl` para que real y mock
   * queden en sintonía. Si en algún momento se pone un CDN delante del bucket, la URL
   * pública deja de ser 1:1 con la key de S3 y este parseo se rompe -- no es un
   * problema de este ticket, pero queda documentado como limitación conocida.
   */
  getKeyFromUrl(url: string): string | null;

  /** Best-effort: quien llama decide si un fallo acá bloquea el request o solo se loguea. */
  deleteObject(key: string): Promise<void>;
}

export interface StorageProviderConfig {
  STORAGE_PROVIDER: "mock" | "s3";
  S3_BUCKET_NAME?: string;
  S3_REGION?: string;
}

/**
 * Selecciona la implementación según `STORAGE_PROVIDER` (default "mock", mismo
 * criterio que `SMS_PROVIDER=console`/`DIDIT_MODE=mock`/`GEOCODING_PROVIDER=mock`): no
 * depender de un bucket real ni de credenciales de AWS para levantar el servicio en
 * dev/test/CI. Falla rápido al arrancar si se pide "s3" sin bucket/región -- la
 * obligatoriedad de esas dos vars con STORAGE_PROVIDER=s3 se valida acá, no en
 * `envSchema` (mismo patrón que Twilio/Didit/Google Maps).
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
