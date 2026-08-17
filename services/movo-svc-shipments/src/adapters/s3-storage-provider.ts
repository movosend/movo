import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ApiError } from "@movo/shared";
import { StorageProvider } from "./storage-provider";

export interface S3StorageProviderConfig {
  bucketName: string;
  region: string;
}

/** TTL corto (AC3 de MOVO-81) -- una presigned URL no debería quedar viva más que el
 * tiempo que le toma al cliente elegir/ver la foto. Mismo valor para upload y download. */
const PRESIGNED_URL_TTL_SECONDS = 300;

/**
 * Implementación real sobre S3 (ADR-007/ADR-015). Credenciales vía el default
 * credential provider chain del SDK -- IAM role de la instancia EC2, mismo criterio que
 * `movo-svc-users` (nada nuevo que rotar en Secrets Manager). El bucket es compartido
 * con `svc-users` (`movo-shipment-media-{env}`), distinto prefijo (`shipments/*`,
 * privado -- a diferencia de `profile-photos/*`, que es de lectura pública).
 */
export function createS3StorageProvider(config: S3StorageProviderConfig): StorageProvider {
  const client = new S3Client({ region: config.region });

  return {
    async createUploadUrl(input) {
      // `signableHeaders` fuerza a que Content-Type/Content-Length viajen firmados
      // dentro de la URL: el cliente tiene que mandar esos headers exactos en el PUT o
      // S3 rechaza la firma (403 SignatureDoesNotMatch) -- es lo que hace que el tipo/
      // tamaño declarados acá no sean solo una validación de entrada (AC3).
      const command = new PutObjectCommand({
        Bucket: config.bucketName,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      });
      let uploadUrl: string;
      try {
        uploadUrl = await getSignedUrl(client, command, {
          expiresIn: PRESIGNED_URL_TTL_SECONDS,
          signableHeaders: new Set(["content-type", "content-length"]),
        });
      } catch {
        throw new ApiError(502, "STORAGE_PROVIDER_ERROR", "No se pudo generar la URL de subida.");
      }
      return { uploadUrl, expiresIn: PRESIGNED_URL_TTL_SECONDS };
    },

    async headObject(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: config.bucketName, Key: key }));
        return {
          exists: true,
          ...(result.ContentType ? { contentType: result.ContentType } : {}),
          ...(result.ContentLength !== undefined ? { contentLength: result.ContentLength } : {}),
        };
      } catch (error) {
        const name = (error as { name?: string })?.["name"];
        if (name === "NotFound" || name === "NoSuchKey") {
          return { exists: false };
        }
        throw new ApiError(502, "STORAGE_PROVIDER_ERROR", "No se pudo verificar el objeto en el storage.");
      }
    },

    async createDownloadUrl(key) {
      // Bucket privado para este prefijo (AC8) -- a diferencia de `profile-photos/*` en
      // `movo-svc-users`, acá no hay URL pública estable: cada lectura pide una
      // presigned GET nueva (AC7).
      let url: string;
      try {
        url = await getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucketName, Key: key }), {
          expiresIn: PRESIGNED_URL_TTL_SECONDS,
        });
      } catch {
        throw new ApiError(502, "STORAGE_PROVIDER_ERROR", "No se pudo generar la URL de lectura.");
      }
      return { url, expiresIn: PRESIGNED_URL_TTL_SECONDS };
    },
  };
}
