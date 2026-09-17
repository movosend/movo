import { randomUUID } from "node:crypto";
import { FastifyBaseLogger } from "fastify";
import type Redis from "ioredis";
import { ApiError, ShipmentStatus, UserRole } from "@movo/shared";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { StorageProvider } from "../../adapters/storage-provider";
import { Shipment, PhotoStage } from "../../models/shipment";
import { MAX_EVIDENCE_PHOTOS_PER_STAGE, MIN_EVIDENCE_PHOTOS_PER_STAGE } from "../../domain/evidence-photos";
import { assertIsCarrier, assertShipmentAccess } from "./assert-shipment-access";

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

/** Fix de review (PR #161): lock por (shipmentId, stage) que cierra el TOCTOU entre
 * `countPhotosByStage()` y el `addPhoto()` de AC8 -- el lock de arriba es por s3Key
 * (único por foto), así que dos `confirmPhoto()` concurrentes con distinto s3Key para
 * la misma etapa podían leer el mismo conteo (<5) antes de que ninguno insertara y
 * terminar superando `MAX_EVIDENCE_PHOTOS_PER_STAGE`. TTL corto, misma familia que el
 * lock de arriba: la sección crítica que cubre (un COUNT + un INSERT) es igual de
 * rápida. */
export function photoStageCountLockKey(shipmentId: string, stage: PhotoStage): string {
  return `locks:photo-stage-count:shipments:${shipmentId}:${stage}`;
}
export const PHOTO_STAGE_COUNT_LOCK_TTL_MS = 5_000;

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

/** AC6 de MOVO-196: `stage` es `null` cuando el envío no está en un estado con
 * handshake pendiente (ni retiro ni entrega por confirmar) -- no hay evidencia
 * "relevante" que chequear, así que `satisfied` resuelve `true` sin consultar nada. */
export interface EvidenceStatusDto {
  stage: Extract<PhotoStage, "pickup" | "delivery"> | null;
  satisfied: boolean;
  photoCount: number;
  minRequired: number;
  maxAllowed: number;
}

/**
 * AC5 de MOVO-196: `creation` sigue siendo del emisor (MOVO-81, sin cambios);
 * `pickup`/`delivery` son evidencia del transportista asignado -- ni el emisor ni el
 * receptor pueden registrarla, sin importar si hoy son parte del envío por otro motivo.
 */
function assertCanRegisterPhoto(shipment: Shipment, callerId: string, stage: PhotoStage): void {
  if (stage === PhotoStage.creation) {
    if (callerId !== shipment.senderId) {
      throw new ApiError(403, "AUTH_FORBIDDEN", "Solo el emisor puede registrar esta foto.");
    }
    return;
  }
  assertIsCarrier(shipment, callerId);
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
    /** AC1/AC2/AC3 de MOVO-81, AC5 de MOVO-196: el emisor pide presign para `creation`;
     * el transportista asignado, para `pickup`/`delivery`. El objectKey lo genera
     * siempre el servidor, nunca uno propuesto por el cliente. */
    async getPhotoUploadUrl(
      shipmentId: string,
      callerId: string,
      input: PresignPhotoInput
    ): Promise<{ uploadUrl: string; s3Key: string; expiresIn: number }> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }
      assertCanRegisterPhoto(shipment, callerId, input.stage);
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

    /** AC4/AC5 de MOVO-81: verifica contra S3 (HEAD real) que el objeto exista antes de
     * registrarlo -- sin esto, el cliente podría confirmar fotos que nunca subió y el
     * criterio de evidencia obligatoria quedaría vacío. AC5/AC8 de MOVO-196: autoriza
     * por etapa (emisor para `creation`, transportista asignado para `pickup`/
     * `delivery`) y tapea en `MAX_EVIDENCE_PHOTOS_PER_STAGE` las dos últimas. */
    async confirmPhoto(
      shipmentId: string,
      callerId: string,
      input: ConfirmPhotoInput
    ): Promise<{ id: string; stage: PhotoStage; createdAt: Date }> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }
      assertCanRegisterPhoto(shipment, callerId, input.stage);

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

      // Fix de review (PR #161): lock propio por (shipmentId, stage) alrededor del
      // chequeo de AC8 -- el lock de arriba es por s3Key (único por foto), así que no
      // sirve para serializar el COUNT+INSERT contra OTRA confirmación concurrente de
      // la misma etapa (distinto s3Key). Sin este lock, dos confirmaciones a la vez
      // podían leer el mismo `countPhotosByStage` (<5) antes de que ninguna insertara
      // y terminar superando `MAX_EVIDENCE_PHOTOS_PER_STAGE`. No aplica a `creation`
      // (sin tope propio, MOVO-81).
      const stageLockKey = input.stage !== PhotoStage.creation ? photoStageCountLockKey(shipmentId, input.stage) : null;
      if (stageLockKey) {
        const stageLockAcquired = await redis.set(stageLockKey, "1", "PX", PHOTO_STAGE_COUNT_LOCK_TTL_MS, "NX");
        if (stageLockAcquired !== "OK") {
          await redis.unlink(lockKey);
          throw new ApiError(
            409,
            "PHOTO_CONFIRMATION_IN_PROGRESS",
            "Hay una verificación en curso para esta etapa, reintentá en unos segundos."
          );
        }
      }

      try {
        // AC8 de MOVO-196: dentro del lock de etapa para que el conteo y el insert de
        // abajo sean atómicos entre sí frente a otra confirmación concurrente.
        if (input.stage !== PhotoStage.creation) {
          const existingCount = await repository.countPhotosByStage(shipmentId, input.stage);
          if (existingCount >= MAX_EVIDENCE_PHOTOS_PER_STAGE) {
            throw new ApiError(
              422,
              "PHOTO_STAGE_LIMIT_EXCEEDED",
              `Ya se cargó el máximo de ${MAX_EVIDENCE_PHOTOS_PER_STAGE} fotos para la etapa '${input.stage}'.`
            );
          }
        }

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
        // (PHOTO_CONFIRMATION_LOCK_TTL_MS/PHOTO_STAGE_COUNT_LOCK_TTL_MS), no bloquea
        // más que unos segundos.
        await redis.unlink(lockKey);
        if (stageLockKey) {
          await redis.unlink(stageLockKey);
        }
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

    /** AC6 de MOVO-196: para que el wizard del mobile habilite/deshabilite el paso
     * siguiente sin tener que intentar el handshake y fallar. `stage` sale del
     * `status` actual del envío -- `assigned` implica retiro pendiente (evidencia
     * `pickup`), `in_transit` implica entrega pendiente (evidencia `delivery`);
     * cualquier otro estado no tiene handshake pendiente, así que no hay nada que
     * exigir (`stage: null`, `satisfied: true`). Autorización propia (no
     * `assertShipmentAccess`): además de emisor/receptor/admin, el transportista
     * asignado también necesita consultarlo -- mismo criterio inline que el AC8 de
     * MOVO-142 en `getShipmentDetail`, ese helper compartido no conoce `carrierId`. */
    async getEvidenceStatus(shipmentId: string, callerId: string, callerRoles: UserRole[]): Promise<EvidenceStatusDto> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      const isParty = callerId === shipment.senderId || callerId === shipment.receiverId || callerId === shipment.carrierId;
      const isAdmin = callerRoles.includes(UserRole.ADMIN);
      if (!isParty && !isAdmin) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "No tenés permiso para ver el estado de evidencia de este envío.");
      }

      const stage: Extract<PhotoStage, "pickup" | "delivery"> | null =
        shipment.status === ShipmentStatus.ASSIGNED
          ? PhotoStage.pickup
          : shipment.status === ShipmentStatus.IN_TRANSIT
            ? PhotoStage.delivery
            : null;

      if (!stage) {
        return {
          stage: null,
          satisfied: true,
          photoCount: 0,
          minRequired: MIN_EVIDENCE_PHOTOS_PER_STAGE,
          maxAllowed: MAX_EVIDENCE_PHOTOS_PER_STAGE,
        };
      }

      const photoCount = await repository.countPhotosByStage(shipmentId, stage);
      return {
        stage,
        satisfied: photoCount >= MIN_EVIDENCE_PHOTOS_PER_STAGE,
        photoCount,
        minRequired: MIN_EVIDENCE_PHOTOS_PER_STAGE,
        maxAllowed: MAX_EVIDENCE_PHOTOS_PER_STAGE,
      };
    },
  };
}
