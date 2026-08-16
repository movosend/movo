import { randomUUID } from "node:crypto";
import { ApiError, UserRole } from "@movo/shared";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { StorageProvider } from "../../adapters/storage-provider";
import { PhotoStage } from "../../models/shipment";

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

export function createPhotosService(repository: ShipmentRepository, storageProvider: StorageProvider) {
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
      return { id: photo.id, stage: photo.stage, createdAt: photo.createdAt };
    },

    /** AC7: URLs prefirmadas de lectura, TTL corto, solo para emisor/receptor/admin --
     * mismo chequeo de autorización que `getShipmentDetail` (AC8 de MOVO-80). */
    async listPhotoUrls(shipmentId: string, callerId: string, callerRoles: UserRole[]): Promise<PhotoUrlDto[]> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }
      const isParty = callerId === shipment.senderId || callerId === shipment.receiverId;
      const isAdmin = callerRoles.includes(UserRole.ADMIN);
      if (!isParty && !isAdmin) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "No tenés permiso para ver las fotos de este envío.");
      }

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
