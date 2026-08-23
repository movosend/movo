import { randomUUID } from "node:crypto";
import { FastifyBaseLogger } from "fastify";
import type Redis from "ioredis";
import { ApiError, UserRole } from "@movo/shared";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { StorageProvider } from "../../adapters/storage-provider";
import { PhotoStage } from "../../models/shipment";
import { assertShipmentAccess } from "./assert-shipment-access";

/** MOVO-124: sorted set de Redis con las keys de S3 pendientes de confirmar (score =
 * timestamp del presign). Es solo un candidato-list para el sweep de fotos huérfanas
 * -- Postgres (`shipment_photos`) sigue siendo la única fuente de verdad de "confirmado
 * o no" (ver `existsPhotoByS3Key`). Exportada para que `orphan-photo-sweep.ts` use la
 * misma key sin duplicar el literal. */
export const PENDING_PHOTOS_REDIS_KEY = "photos:pending:shipments";

/** Fix de review (PR #96): lock por key de S3 que se disputan `confirmPhoto()` y el
 * sweep de fotos huérfanas (`orphan-photo-sweep.ts`) -- sin esto hay una ventana de
 * TOCTOU real (no solo teórica, dado que la confirmación puede llegar en una sesión
 * posterior, más allá de `ORPHAN_PHOTO_RETENTION_HOURS`): el sweep puede leer
 * "no confirmada" en Postgres, y entre esa lectura y su `deleteObject` de S3,
 * `confirmPhoto()` puede terminar de commitear la fila -- el objeto queda borrado
 * pero la foto figura confirmada, sin ningún error visible (viola AC3 de MOVO-124).
 * TTL corto: ninguna de las dos secciones críticas hace más que un HEAD/DELETE de S3
 * + una consulta a Postgres. */
export function photoConfirmationLockKey(s3Key: string): string {
  return `locks:orphan-photo-sweep:key:shipments:${s3Key}`;
}
export const PHOTO_CONFIRMATION_LOCK_TTL_MS = 5_000;

/** AC10 de MOVO-81: convención de key `shipments/{shipmentId}/{stage}/{uuid}.jpg`.
 * A diferencia del whitelist de 3 tipos de MOVO-97 (foto de perfil), acá el AC10 fija
 * la extensión en `.jpg` -- consistente con la guía del ticket de comprimir a JPEG en
 * cliente antes de subir. Duplicado en `shipments.schema.ts` (mismo criterio que
 * `MAX_PHOTO_CONTENT_LENGTH_BYTES` en `users.service.ts`) -- si se agrega un tipo acá,
 * agregarlo también ahí. */
const ALLOWED_PHOTO_CONTENT_TYPE = "image/jpeg";

/** 2 MB -- sugerido explícito del ticket (no los 5 MB de la foto de perfil): fotos de
 * 12 MP pesan varios MB y en conexiones móviles argentinas la subida falla seguido: se
 * espera que el cliente comprima a ~1600px/calidad 0.7 antes de pedir la URL. */
const MAX_PHOTO_CONTENT_LENGTH_BYTES = 2 * 1024 * 1024;

export interface PresignPhotoInput {
  stage: PhotoStage;
  contentType: string;
  contentLength: number;
}

export interface ConfirmPhotoInput {
  s3Key: string;
  stage: PhotoStage;
}

export interface PhotoUrlDto {
  id: string;
  stage: PhotoStage;
  url: string;
  expiresIn: number;
  createdAt: Date;
}

function assertValidPhotoConstraints(contentType: string, contentLength: number): void {
  if (contentType !== ALLOWED_PHOTO_CONTENT_TYPE) {
    throw new ApiError(400, "VALIDATION_FAILED", "Tipo de imagen no permitido.");
  }
  if (contentLength <= 0 || contentLength > MAX_PHOTO_CONTENT_LENGTH_BYTES) {
    throw new ApiError(400, "VALIDATION_FAILED", "El tamaño de la imagen supera el máximo permitido (2 MB).");
  }
}

export function createPhotosService(
  repository: ShipmentRepository,
  storageProvider: StorageProvider,
  redis: Redis,
  logger: FastifyBaseLogger
) {
  return {
    /** AC1/AC2/AC3: solo el emisor puede pedir presign para la etapa `creation` (única
     * etapa que autoriza esta US -- pickup/delivery quedan para MOVO-21). El objectKey
     * lo genera siempre el servidor, nunca uno propuesto por el cliente. */
    async getPhotoUploadUrl(
      shipmentId: string,
      callerId: string,
      input: PresignPhotoInput
    ): Promise<{ uploadUrl: string; s3Key: string; expiresIn: number }> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }
      if (callerId !== shipment.senderId) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Solo el emisor puede solicitar la subida de esta foto.");
      }
      assertValidPhotoConstraints(input.contentType, input.contentLength);

      const s3Key = `shipments/${shipmentId}/${input.stage}/${randomUUID()}.jpg`;
      const { uploadUrl, expiresIn } = await storageProvider.createUploadUrl({
        key: s3Key,
        contentType: input.contentType,
        contentLength: input.contentLength,
      });

      // MOVO-124: registra la key como "pendiente" para que el sweep de fotos huérfanas
      // la pueda encontrar si nunca se confirma. Best-effort -- si Redis falla acá, el
      // objeto queda sin trackear (mismo estado que el bug original: huérfano para
      // siempre, nunca borrado de más).
      try {
        await redis.zadd(PENDING_PHOTOS_REDIS_KEY, Date.now(), s3Key);
      } catch (error) {
        logger.warn(
          { shipmentId, s3Key, event: "photo_pending_track_failed", error: (error as Error).message },
          "No se pudo registrar la foto como pendiente en Redis"
        );
      }

      return { uploadUrl, s3Key, expiresIn };
    },

    /** AC4/AC5: verifica contra S3 (HEAD real) que el objeto exista antes de registrarlo
     * -- sin esto, el cliente podría confirmar fotos que nunca subió y el criterio de
     * evidencia obligatoria quedaría vacío. */
    async confirmPhoto(
      shipmentId: string,
      callerId: string,
      input: ConfirmPhotoInput
    ): Promise<{ id: string; stage: PhotoStage; createdAt: Date }> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }
      if (callerId !== shipment.senderId) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Solo el emisor puede confirmar esta foto.");
      }

      const expectedPrefix = `shipments/${shipmentId}/${input.stage}/`;
      if (!input.s3Key.startsWith(expectedPrefix)) {
        throw new ApiError(403, "PHOTO_FORBIDDEN_KEY", "La imagen no pertenece a este envío/etapa.");
      }

      // Fix de review (PR #96): toma el mismo lock que usa el sweep de fotos huérfanas
      // para esta key antes de tocar S3/Postgres -- cierra la ventana de TOCTOU entre
      // "el sweep decide borrar" y "confirmPhoto termina de commitear la fila" (ver el
      // comentario de `photoConfirmationLockKey`). Si el sweep tiene el lock en este
      // preciso instante, se rechaza en vez de arriesgar una confirmación fantasma --
      // el cliente puede reintentar de inmediato, el lock dura pocos segundos.
      const lockKey = photoConfirmationLockKey(input.s3Key);
      const lockAcquired = await redis.set(lockKey, "1", "PX", PHOTO_CONFIRMATION_LOCK_TTL_MS, "NX");
      if (lockAcquired !== "OK") {
        throw new ApiError(
          409,
          "PHOTO_CONFIRMATION_IN_PROGRESS",
          "Hay una verificación en curso para esta imagen, reintentá en unos segundos."
        );
      }

      try {
        const head = await storageProvider.headObject(input.s3Key);
        if (!head.exists) {
          throw new ApiError(422, "PHOTO_OBJECT_NOT_FOUND", "La imagen no existe en el storage.");
        }
        // Defensa en profundidad (igual que MOVO-97): revalida el tipo/tamaño reales que
        // S3 reporta, no solo lo que el cliente declaró al pedir la URL.
        if (head.contentType !== undefined && head.contentLength !== undefined) {
          assertValidPhotoConstraints(head.contentType, head.contentLength);
        }

        const photo = await repository.addPhoto(shipmentId, input.stage, input.s3Key);

        // MOVO-124: saca la key del tracking de pendientes -- ya está confirmada, el
        // sweep no debería volver a evaluarla. Best-effort: si el ZREM falla, el sweep
        // igual la va a dejar en paz porque revalida contra Postgres antes de borrar
        // nada (AC3), esto es solo para no reprocesarla en cada corrida.
        try {
          await redis.zrem(PENDING_PHOTOS_REDIS_KEY, input.s3Key);
        } catch (error) {
          logger.warn(
            {
              shipmentId,
              s3Key: input.s3Key,
              event: "photo_pending_untrack_failed",
              error: (error as Error).message,
            },
            "No se pudo remover el tracking de Redis tras confirmar la foto"
          );
        }

        return { id: photo.id, stage: photo.stage, createdAt: photo.createdAt };
      } finally {
        // Mismo criterio que `account-deletion-lock` en `svc-users`: si el `unlink`
        // llegara a fallar, el lock igual expira solo por TTL
        // (PHOTO_CONFIRMATION_LOCK_TTL_MS), no bloquea al mismo s3Key más que unos
        // segundos.
        await redis.unlink(lockKey);
      }
    },

    /** AC7: URLs prefirmadas de lectura, TTL corto, solo para emisor/receptor/admin --
     * mismo chequeo de autorización que `getShipmentDetail` (AC8 de MOVO-80). */
    async listPhotoUrls(shipmentId: string, callerId: string, callerRoles: UserRole[]): Promise<PhotoUrlDto[]> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }
      assertShipmentAccess(shipment, callerId, callerRoles, "No tenés permiso para ver las fotos de este envío.");

      const photos = await repository.listPhotos(shipmentId);
      return Promise.all(
        photos.map(async (photo) => {
          const { url, expiresIn } = await storageProvider.createDownloadUrl(photo.s3Key);
          return { id: photo.id, stage: photo.stage, url, expiresIn, createdAt: photo.createdAt };
        })
      );
    },
  };
}
