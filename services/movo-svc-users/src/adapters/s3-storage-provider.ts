import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ApiError } from "@movo/shared";
import { StorageProvider } from "./storage-provider";

export interface S3StorageProviderConfig {
  bucketName: string;
  region: string;
}

/** TTL corto (AC1 de MOVO-97): una presigned URL de subida no debería quedar viva más
 * que el tiempo que le toma al cliente elegir la foto y subirla. */
const UPLOAD_URL_TTL_SECONDS = 300;

/**
 * Implementación real sobre S3 (ADR-007/ADR-015). Credenciales vía el default
 * credential provider chain del SDK -- IAM role de la instancia EC2, nunca un
 * access key/secret propio (decisión del ticket: nada nuevo que rotar en Secrets
 * Manager, mismo mecanismo que ya usa el deploy para leer Secrets Manager).
 */
export function createS3StorageProvider(config: S3StorageProviderConfig): StorageProvider {
  const client = new S3Client({ region: config.region });
  // Virtual-hosted-style, determinístico -- `getKeyFromUrl` es su inversa exacta.
  const publicUrlHost = `${config.bucketName}.s3.${config.region}.amazonaws.com`;

  return {
    async createUploadUrl(input) {
      // `signableHeaders` fuerza a que Content-Type/Content-Length viajen firmados
      // dentro de la URL: el cliente tiene que mandar esos headers exactos en el PUT o
      // S3 rechaza la firma (403 SignatureDoesNotMatch). Es lo que hace que el tipo/
      // tamaño declarados acá no sean solo una validación de entrada (AC2) -- Content-
      // Length firmado + HTTP estándar (el servidor solo lee esa cantidad de bytes)
      // acota el tamaño real subido al que se validó antes de firmar.
      const command = new PutObjectCommand({
        Bucket: config.bucketName,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      });
      let uploadUrl: string;
      try {
        uploadUrl = await getSignedUrl(client, command, {
          expiresIn: UPLOAD_URL_TTL_SECONDS,
          signableHeaders: new Set(["content-type", "content-length"]),
        });
      } catch {
        throw new ApiError(502, "STORAGE_PROVIDER_ERROR", "No se pudo generar la URL de subida.");
      }
      return { uploadUrl, expiresIn: UPLOAD_URL_TTL_SECONDS };
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

    getPublicUrl(key) {
      return `https://${publicUrlHost}/${key}`;
    },

    getKeyFromUrl(url) {
      try {
        const parsed = new URL(url);
        if (parsed.hostname !== publicUrlHost) {
          return null;
        }
        return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
      } catch {
        return null;
      }
    },

    async deleteObject(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }));
      } catch {
        throw new ApiError(502, "STORAGE_PROVIDER_ERROR", "No se pudo borrar el objeto del storage.");
      }
    },
  };
}
