import { randomUUID } from "node:crypto";
import { FastifyBaseLogger } from "fastify";
import { hash, verify } from "@node-rs/argon2";
import Redis from "ioredis";
import { AccountStatus, ApiError } from "@movo/shared";
import { PrismaClient } from "../../generated/prisma/client";
import { createUserRepository } from "../../repositories/user-repository";
import { createPushTokenRepository } from "../../repositories/push-token-repository";
import { createSessionRepository } from "../../repositories/session-repository";
import { PrivateProfile, PublicProfile, toPrivateProfile, toPublicProfile } from "../../models/user-profile";
import { StorageProvider } from "../../adapters/storage-provider";
import { PushPlatform } from "../../models/push-token";
import { ShipmentsClient } from "../../adapters/shipments-client";
import { issueSession, LoginUserResult } from "../auth/auth.service";

// @node-rs/argon2 exporta `Algorithm` como `const enum`, incompatible con
// `isolatedModules` -- mismo motivo/valor que auth.service.ts/otp-service.ts.
const ARGON2ID = 2;

// MOVO-134: rate limit "por usuario" del cambio de contraseña -- el gateway no puede
// aplicar esto (su rate-limiting corre antes de decodificar el JWT, así que solo
// conoce la IP, nunca el userId; ver los 4 rate limits estrictos ya existentes en
// gateway/src/config/routes-map.ts, todos keyeados por IP). Mismo patrón que el
// contador de intentos de OTP (otp-repository.ts#incrementAttempts), pero por ventana
// fija en vez de contador+invalidación.
const PASSWORD_CHANGE_RATE_LIMIT_MAX = 5;
const PASSWORD_CHANGE_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

async function checkPasswordChangeRateLimit(redis: Redis, userId: string): Promise<void> {
  const key = `password-change-attempts:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, PASSWORD_CHANGE_RATE_LIMIT_WINDOW_SECONDS);
  }
  if (count > PASSWORD_CHANGE_RATE_LIMIT_MAX) {
    throw new ApiError(
      429,
      "RATE_LIMIT_EXCEEDED",
      "Demasiados intentos de cambio de contraseña. Esperá unos minutos antes de reintentar."
    );
  }
}

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

export interface RegisterPushTokenInput {
  expoPushToken: string;
  deviceId: string;
  platform: PushPlatform;
}

export function createUsersService(
  db: PrismaClient,
  storageProvider: StorageProvider,
  logger: FastifyBaseLogger,
  redis: Redis,
  shipmentsClient: ShipmentsClient
) {
  const repository = createUserRepository(db);
  const pushTokenRepository = createPushTokenRepository(db);
  const sessionRepository = createSessionRepository(redis);

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

    /** AC3 de MOVO-80: búsqueda de receptor por nombre completo. Devuelve la
     * proyección pública -- nunca expone email/teléfono como criterio de búsqueda ni
     * como resultado, evita habilitar enumeración de usuarios. */
    async searchUsers(query: string, callerId: string): Promise<PublicProfile[]> {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        throw new ApiError(400, "VALIDATION_FAILED", "El término de búsqueda debe tener al menos 2 caracteres.");
      }
      const users = await repository.search(trimmed, callerId, 20);
      return users.map(toPublicProfile);
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

      // `headObject` y `findById` son independientes entre sí — se piden en paralelo
      // para no pagar dos round-trips en serie en cada confirmación.
      const [head, user] = await Promise.all([storageProvider.headObject(objectKey), repository.findById(userId)]);
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

    /** AC1/AC2: upsert por `(user_id, device_id)` — un mismo dispositivo reemplaza su
     * token vigente en vez de acumular filas duplicadas. */
    async registerPushToken(
      userId: string,
      input: RegisterPushTokenInput
    ): Promise<{ deviceId: string; platform: PushPlatform }> {
      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      const token = await pushTokenRepository.upsert({
        userId,
        deviceId: input.deviceId,
        expoPushToken: input.expoPushToken,
        platform: input.platform,
      });
      return { deviceId: token.deviceId, platform: token.platform };
    },

    /** AC3: idempotente — sin token previo para ese dispositivo, no-op (204 igual). */
    async unregisterPushToken(userId: string, deviceId: string): Promise<void> {
      await pushTokenRepository.deleteByDeviceId(userId, deviceId);
    },

    /**
     * MOVO-134: cambio de contraseña. Revoca todas las sesiones y emite un par de
     * tokens nuevo (mismo shape que login()) -- quien hizo el cambio no queda
     * deslogueado, el resto de los dispositivos sí (motivo de devolver tokens en vez
     * de 204).
     */
    async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<LoginUserResult> {
      await checkPasswordChangeRateLimit(redis, userId);

      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }

      const isValidPassword = await verify(user.passwordHash, currentPassword);
      if (!isValidPassword) {
        throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Credenciales inválidas.");
      }

      if (newPassword === currentPassword) {
        throw new ApiError(400, "VALIDATION_FAILED", "La contraseña nueva no puede ser igual a la actual.");
      }

      const newPasswordHash = await hash(newPassword, { algorithm: ARGON2ID });
      const updated = await repository.updatePassword(userId, newPasswordHash);
      if (!updated) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }

      await sessionRepository.revokeAllForUser(userId);
      return issueSession(sessionRepository, updated);
    },

    /**
     * MOVO-134: baja de cuenta. Bloquea con 409 si el usuario tiene una disputa o un
     * envío activo (cualquier rol: emisor/receptor/transportista) -- sin cascada de
     * cancelación, el usuario cancela por su cuenta y reintenta. Idempotente: una
     * cuenta ya `deleted` no vuelve a validar nada (ni password, ni envíos activos).
     */
    async deleteAccount(userId: string, password: string): Promise<void> {
      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      if (user.status === AccountStatus.DELETED) {
        return;
      }

      const isValidPassword = await verify(user.passwordHash, password);
      if (!isValidPassword) {
        throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Credenciales inválidas.");
      }

      const { hasActiveDispute, hasActiveShipments } = await shipmentsClient.hasActiveShipments(userId);
      if (hasActiveDispute) {
        throw new ApiError(
          409,
          "ACCOUNT_HAS_ACTIVE_DISPUTES",
          "Tenés una disputa activa -- un administrador tiene que resolverla antes de poder dar de baja tu cuenta."
        );
      }
      if (hasActiveShipments) {
        throw new ApiError(
          409,
          "ACCOUNT_HAS_ACTIVE_SHIPMENTS",
          "Tenés envíos activos -- cancelalos antes de poder dar de baja tu cuenta."
        );
      }

      const previousPhotoUrl = user.photoUrl;

      await db.$transaction(async (tx) => {
        const txUserRepository = createUserRepository(tx);
        const txPushTokenRepository = createPushTokenRepository(tx);
        await txUserRepository.anonymizeAndDelete(userId);
        await txPushTokenRepository.deleteAllByUserId(userId);
        // address-repository.ts#delete() abre su propia $transaction (para promover
        // un nuevo default) -- no se puede componer acá, necesita un PrismaClient
        // completo. Un deleteMany crudo no tiene esa lógica que preservar: no queda
        // ningún usuario que necesite un default después de esto.
        await tx.address.deleteMany({ where: { userId } });
      });

      await sessionRepository.revokeAllForUser(userId);

      if (previousPhotoUrl) {
        const key = storageProvider.getKeyFromUrl(previousPhotoUrl);
        if (key) {
          try {
            await storageProvider.deleteObject(key);
          } catch (error) {
            logger.warn(
              { userId, key, event: "photo_delete_orphan_failed", error: (error as Error).message },
              "No se pudo borrar la foto de perfil al dar de baja la cuenta"
            );
          }
        }
      }
    },
  };
}
