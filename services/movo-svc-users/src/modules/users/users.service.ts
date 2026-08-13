import { randomUUID } from "node:crypto";
import { FastifyBaseLogger } from "fastify";
import { AccountStatus, ApiError } from "@movo/shared";
import { PrismaClient } from "../../generated/prisma/client";
import { createUserRepository } from "../../repositories/user-repository";
import { PrivateProfile, PublicProfile, toPrivateProfile, toPublicProfile } from "../../models/user-profile";
import { StorageProvider } from "../../adapters/storage-provider";

/** AC2 de MOVO-97: whitelist de tipos permitidos para la foto de perfil. Duplicada en
 * `users.schema.ts` (JSON schema autocontenido, mismo criterio que el resto de los
 * módulos) -- si se agrega un tipo acá, agregarlo también ahí. */
const ALLOWED_PHOTO_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** AC2: 5 MB. Mismo valor duplicado en `users.schema.ts` (`maximum` del body de
 * `upload-url`) -- ver comentario de arriba. */
const MAX_PHOTO_CONTENT_LENGTH_BYTES = 5 * 1024 * 1024;

export interface PhotoUploadUrlInput {
  contentType: string;
  contentLength: number;
}

function assertValidPhotoConstraints(contentType: string, contentLength: number): string {
  const ext = ALLOWED_PHOTO_CONTENT_TYPES[contentType];
  if (!ext) {
    throw new ApiError(400, "VALIDATION_FAILED", "Tipo de imagen no permitido.");
  }
  if (contentLength <= 0 || contentLength > MAX_PHOTO_CONTENT_LENGTH_BYTES) {
    throw new ApiError(400, "VALIDATION_FAILED", "El tamaño de la imagen supera el máximo permitido (5 MB).");
  }
  return ext;
}

export function createUsersService(db: PrismaClient, storageProvider: StorageProvider, logger: FastifyBaseLogger) {
  const repository = createUserRepository(db);

  return {
    async getUsersCount(): Promise<number> {
      return repository.count();
    },

    async getPrivateProfile(userId: string): Promise<PrivateProfile> {
      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      return toPrivateProfile(user);
    },

    async getPublicProfile(id: string): Promise<PublicProfile> {
      const user = await repository.findById(id);
      // `deleted` es baja lógica (el registro sigue en la DB) pero se trata como
      // "no existe" hacia afuera: decisión de equipo en review de PR #55 (tmvergara),
      // en línea con el espíritu de protección de datos de MOVO-39 (baja de cuenta),
      // aunque esa US todavía no está implementada. `USER_NOT_FOUND` genérico a
      // propósito, para no distinguir "nunca existió" de "se dio de baja".
      //
      // `banned` sí se sirve como cualquier perfil activo: a diferencia de `deleted`,
      // no es una baja voluntaria — es una sanción reversible (`bannedUntil` puede ser
      // temporal) y el usuario puede tener envíos históricos con una contraparte que
      // necesita seguir viendo con quién trató. Trade-off aceptado: no hay ninguna
      // señal hacia afuera de que la cuenta está baneada (agregar una implicaría un
      // cambio de contrato fuera del alcance de AC3 de MOVO-77).
      if (!user || user.status === AccountStatus.DELETED) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      return toPublicProfile(user);
    },

    /** AC1/AC2/AC3: emite la presigned URL de subida. El `objectKey` lo genera el
     * servidor siempre — nunca se acepta uno propuesto por el cliente (permitiría
     * escribir sobre la foto de otro usuario o fuera del prefijo). */
    async getPhotoUploadUrl(
      userId: string,
      input: PhotoUploadUrlInput
    ): Promise<{ uploadUrl: string; objectKey: string; expiresIn: number }> {
      const ext = assertValidPhotoConstraints(input.contentType, input.contentLength);
      const objectKey = `profile-photos/${userId}/${randomUUID()}.${ext}`;
      const { uploadUrl, expiresIn } = await storageProvider.createUploadUrl({
        key: objectKey,
        contentType: input.contentType,
        contentLength: input.contentLength,
      });
      return { uploadUrl, objectKey, expiresIn };
    },

    /** AC4/AC5/AC6: confirma la subida contra S3 (HEAD real, no solo confiar en el
     * request) y recién ahí persiste `photo_url`. Mientras esto no ocurra, `photo_url`
     * no cambia — un PUT fallido a S3 no deja la DB apuntando a un objeto inexistente. */
    async confirmPhoto(userId: string, objectKey: string): Promise<{ photoUrl: string }> {
      const expectedPrefix = `profile-photos/${userId}/`;
      if (!objectKey.startsWith(expectedPrefix)) {
        throw new ApiError(403, "PHOTO_FORBIDDEN_KEY", "La imagen no pertenece al usuario autenticado.");
      }

      const head = await storageProvider.headObject(objectKey);
      if (!head.exists) {
        throw new ApiError(422, "PHOTO_OBJECT_NOT_FOUND", "La imagen no existe en el storage.");
      }
      // Defensa en profundidad (AC4): revalida el tipo/tamaño reales que S3 reporta,
      // no solo lo que el cliente declaró al pedir la URL. Si el HEAD no trae alguno de
      // los dos (proveedor caído a medias, u objeto sin metadata), no bloquea acá — el
      // gate principal ya corrió al firmar la URL (`createUploadUrl`).
      if (head.contentType !== undefined && head.contentLength !== undefined) {
        assertValidPhotoConstraints(head.contentType, head.contentLength);
      }

      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }

      const photoUrl = storageProvider.getPublicUrl(objectKey);
      const updated = await repository.updatePhotoUrl(userId, photoUrl);
      if (!updated) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }

      // AC6: al reemplazar, el objeto anterior se borra best-effort — la foto nueva ya
      // es la buena, un fallo de borrado es basura huérfana, no un error para el
      // usuario. `previousKey !== objectKey` cubre el caso (raro pero posible) de
      // confirmar dos veces la misma key.
      if (user.photoUrl) {
        const previousKey = storageProvider.getKeyFromUrl(user.photoUrl);
        if (previousKey && previousKey !== objectKey) {
          try {
            await storageProvider.deleteObject(previousKey);
          } catch (error) {
            logger.warn(
              { userId, previousKey, event: "photo_delete_orphan_failed", error: (error as Error).message },
              "No se pudo borrar la foto de perfil anterior"
            );
          }
        }
      }

      return { photoUrl };
    },

    /** AC7: idempotente — sin foto previa también responde éxito. */
    async deletePhoto(userId: string): Promise<void> {
      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      if (!user.photoUrl) {
        return;
      }

      const key = storageProvider.getKeyFromUrl(user.photoUrl);
      await repository.updatePhotoUrl(userId, null);

      if (key) {
        try {
          await storageProvider.deleteObject(key);
        } catch (error) {
          logger.warn(
            { userId, key, event: "photo_delete_orphan_failed", error: (error as Error).message },
            "No se pudo borrar el objeto de la foto de perfil"
          );
        }
      }
    },
  };
}
