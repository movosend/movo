import { randomUUID } from "node:crypto";
import { FastifyBaseLogger } from "fastify";
import { hash, verify } from "@node-rs/argon2";
import Redis from "ioredis";
import { AccountStatus, ApiError, KycStatus } from "@movo/shared";
import { PrismaClient } from "../../generated/prisma/client";
import { createUserRepository } from "../../repositories/user-repository";
import { createPushTokenRepository } from "../../repositories/push-token-repository";
import { createSessionRepository } from "../../repositories/session-repository";
import { PrivateProfile, PublicProfile, toPrivateProfile, toPublicProfile } from "../../models/user-profile";
import { UserConflictError } from "../../models/user";
import { StorageProvider } from "../../adapters/storage-provider";
import { PushPlatform } from "../../models/push-token";
import { ShipmentsClient } from "../../adapters/shipments-client";
import { issueSession, LoginUserResult, normalizePhoneToE164Ar } from "../auth/auth.service";
import { OtpService } from "../../services/otp-service";
import { buildEmailChangedNotice, EmailProvider } from "../../adapters/email-provider";

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

// MOVO-134 (review de tmvergara): 30s alcanza de sobra -- la transacción de
// anonimización + la llamada a shipmentsClient son las dos únicas operaciones que
// cubre, ninguna tarda más que eso en el peor caso normal.
const ACCOUNT_DELETION_LOCK_TTL_SECONDS = 30;

/** MOVO-124: sorted set de Redis con las keys de S3 pendientes de confirmar (score =
 * timestamp del presign). Es solo un candidato-list para el sweep de fotos huérfanas
 * -- Postgres (`users.photo_url`) sigue siendo la única fuente de verdad de
 * "confirmado o no" (ver `existsByPhotoUrl`). Exportada para que
 * `orphan-photo-sweep.ts` use la misma key sin duplicar el literal. */
export const PENDING_PHOTOS_REDIS_KEY = "photos:pending:profile-photos";

/** Fix de review (PR #96): lock por key de S3 que se disputan `confirmPhoto()` y el
 * sweep de fotos huérfanas (`orphan-photo-sweep.ts`) -- sin esto hay una ventana de
 * TOCTOU real: el sweep puede leer "no confirmada" en Postgres, y entre esa lectura y
 * su `deleteObject` de S3, `confirmPhoto()` puede terminar de persistir `photoUrl` --
 * el objeto queda borrado pero el perfil lo da por confirmado, sin ningún error
 * visible (viola AC3 de MOVO-124). Mismo mecanismo que su gemelo de `svc-shipments`
 * (ver `services/movo-svc-shipments/src/modules/shipments/photos.service.ts`). */
export function photoConfirmationLockKey(objectKey: string): string {
  return `locks:orphan-photo-sweep:key:profile-photos:${objectKey}`;
}
export const PHOTO_CONFIRMATION_LOCK_TTL_MS = 5_000;

function passwordChangeAttemptsKey(userId: string): string {
  return `password-change-attempts:${userId}`;
}

/** Cuenta solo intentos fallidos (mismo criterio que `otp-repository.ts#incrementAttempts`) --
 * un cambio exitoso resetea el contador en vez de sumarlo, así 5 cambios legítimos
 * seguidos no dejan al usuario bloqueado. */
async function checkPasswordChangeRateLimit(redis: Redis, userId: string): Promise<void> {
  const key = passwordChangeAttemptsKey(userId);
  const raw = await redis.get(key);
  const count = raw ? Number(raw) : 0;
  if (count >= PASSWORD_CHANGE_RATE_LIMIT_MAX) {
    throw new ApiError(
      429,
      "RATE_LIMIT_EXCEEDED",
      "Demasiados intentos de cambio de contraseña. Esperá unos minutos antes de reintentar."
    );
  }
}

/** `SET NX EX` atómico: si el proceso muriera entre un INCR y un EXPIRE separados, la
 * key quedaría sin TTL y bloquearía al usuario para siempre (sin camino de
 * recuperación salvo entrar a Redis a mano). Con NX, solo el primer intento de la
 * ventana crea la key con su vencimiento; los siguientes solo incrementan una key que
 * ya tiene TTL. */
async function registerFailedPasswordChangeAttempt(redis: Redis, userId: string): Promise<void> {
  const key = passwordChangeAttemptsKey(userId);
  const created = await redis.set(key, 1, "EX", PASSWORD_CHANGE_RATE_LIMIT_WINDOW_SECONDS, "NX");
  if (!created) {
    await redis.incr(key);
  }
}

async function resetPasswordChangeRateLimit(redis: Redis, userId: string): Promise<void> {
  await redis.unlink(passwordChangeAttemptsKey(userId));
}

const OTP_INVALID_MESSAGE = "El código ingresado es inválido o venció.";
const PHONE_ALREADY_IN_USE_MESSAGE = "Ese teléfono ya está en uso por otra cuenta.";
const EMAIL_ALREADY_IN_USE_MESSAGE = "Ese email ya está en uso por otra cuenta.";

// MOVO-133 (review de tmvergara sobre PR #91): namespacea el OTP por flujo (ver
// otp-service.ts) -- sin esto, un mismo target (el teléfono actual de la cuenta, en
// el flujo de email) podía cruzarse con otro flujo sobre el mismo número, o con
// POST /auth/send-otp (pública, sin flujo -- ahora "register").
const PHONE_CHANGE_FLOW = "phone-change";
const EMAIL_CHANGE_FLOW = "email-change";
/** MOVO-139: verificar el email QUE LA CUENTA YA TIENE, distinto de cambiarlo por otro
 * -- flujo propio para que un OTP de uno no pueda consumirse en el otro (AC8). */
const EMAIL_VERIFY_FLOW = "email-verify";

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

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
}

export function createUsersService(
  db: PrismaClient,
  storageProvider: StorageProvider,
  logger: FastifyBaseLogger,
  redis: Redis,
  shipmentsClient: ShipmentsClient,
  otpService: OtpService,
  emailProvider: EmailProvider
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

      // MOVO-124: registra la key como "pendiente" para que el sweep de fotos huérfanas
      // la pueda encontrar si nunca se confirma. Best-effort -- si Redis falla acá, el
      // objeto queda sin trackear (mismo estado que el bug original: huérfano para
      // siempre, nunca borrado de más).
      try {
        await redis.zadd(PENDING_PHOTOS_REDIS_KEY, Date.now(), objectKey);
      } catch (error) {
        logger.warn(
          { userId, objectKey, event: "photo_pending_track_failed", error: (error as Error).message },
          "No se pudo registrar la foto de perfil como pendiente en Redis"
        );
      }

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

      // Fix de review (PR #96): toma el mismo lock que usa el sweep de fotos huérfanas
      // para esta key antes de tocar S3/Postgres -- cierra la ventana de TOCTOU entre
      // "el sweep decide borrar" y "confirmPhoto termina de persistir photoUrl" (ver el
      // comentario de `photoConfirmationLockKey`). Si el sweep tiene el lock en este
      // preciso instante, se rechaza en vez de arriesgar una confirmación fantasma --
      // el cliente puede reintentar de inmediato, el lock dura pocos segundos.
      const lockKey = photoConfirmationLockKey(objectKey);
      const lockAcquired = await redis.set(lockKey, "1", "PX", PHOTO_CONFIRMATION_LOCK_TTL_MS, "NX");
      if (lockAcquired !== "OK") {
        throw new ApiError(
          409,
          "PHOTO_CONFIRMATION_IN_PROGRESS",
          "Hay una verificación en curso para esta imagen, reintentá en unos segundos."
        );
      }

      try {
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

        // MOVO-124: saca la key del tracking de pendientes -- ya está confirmada, el
        // sweep no debería volver a evaluarla. Best-effort: si el ZREM falla, el sweep
        // igual la va a dejar en paz porque revalida contra Postgres antes de borrar
        // nada (AC3), esto es solo para no reprocesarla en cada corrida.
        try {
          await redis.zrem(PENDING_PHOTOS_REDIS_KEY, objectKey);
        } catch (error) {
          logger.warn(
            { userId, objectKey, event: "photo_pending_untrack_failed", error: (error as Error).message },
            "No se pudo remover el tracking de Redis tras confirmar la foto de perfil"
          );
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
      } finally {
        // Mismo criterio que `account-deletion-lock` (arriba): si el `unlink` llegara a
        // fallar, el lock igual expira solo por TTL (PHOTO_CONFIRMATION_LOCK_TTL_MS),
        // no bloquea la misma key más que unos segundos.
        await redis.unlink(lockKey);
      }
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
     * MOVO-134: cambio de contraseña. Revoca todas las sesiones (refresh tokens y,
     * vía `revokeAccessTokensIssuedBefore`, también los access tokens ya emitidos --
     * ver `plugins/auth.ts` del gateway) y emite un par de tokens nuevo (mismo shape
     * que login()) -- quien hizo el cambio no queda deslogueado, el resto de los
     * dispositivos sí (motivo de devolver tokens en vez de 204).
     */
    async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<LoginUserResult> {
      await checkPasswordChangeRateLimit(redis, userId);

      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }

      const isValidPassword = await verify(user.passwordHash, currentPassword);
      if (!isValidPassword) {
        await registerFailedPasswordChangeAttempt(redis, userId);
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

      await resetPasswordChangeRateLimit(redis, userId);
      await sessionRepository.revokeAllForUser(userId);
      await sessionRepository.revokeAccessTokensIssuedBefore(userId);
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

      // MOVO-134 (review de tmvergara): lock por usuario alrededor de todo el bloque
      // de chequeo + anonimización -- sin esto, dos DELETE /users/me concurrentes del
      // mismo usuario (dos dispositivos, doble tap) pasan el chequeo "sin envíos
      // activos" a la vez y uno pisa el trabajo del otro. Cierra ese caso puntual; no
      // cierra la carrera más amplia contra un envío creado desde OTRO servicio en el
      // medio (ver CLAUDE.md, MOVO-134 -- misma clase de TOCTOU que tuvo MOVO-118
      // antes de su fix, aceptado acá por ahora, sin lock distribuido cross-servicio).
      const lockKey = `account-deletion-lock:${userId}`;
      const acquired = await redis.set(lockKey, "1", "EX", ACCOUNT_DELETION_LOCK_TTL_SECONDS, "NX");
      if (!acquired) {
        throw new ApiError(
          409,
          "ACCOUNT_DELETION_IN_PROGRESS",
          "Ya hay una baja de cuenta en curso para este usuario."
        );
      }

      try {
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
          // MOVO-39 (derecho de supresión): `onDelete: Cascade` de `KycVerification`/
          // `DriversLicense` nunca dispara porque la fila de `users` sobrevive a
          // propósito (comentario de arriba) -- hay que borrarlas a mano acá, o
          // `rawDecision`/`external_session_id` (apunta a la sesión de Didit con
          // documento y biometría) y la fecha de vencimiento del carnet quedan en la
          // base después de la baja. Sin FK entrante desde envíos hacia estas tablas,
          // a diferencia de `users`.
          await tx.driversLicense.deleteMany({ where: { userId } });
          await tx.kycVerification.deleteMany({ where: { userId } });
        });

        await sessionRepository.revokeAllForUser(userId);
        await sessionRepository.revokeAccessTokensIssuedBefore(userId);

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
      } finally {
        await redis.unlink(lockKey);
      }
    },

    /**
     * AC1/AC2/AC3 de MOVO-133: actualización parcial de nombre/apellido. El schema de
     * `PATCH /users/me` (`additionalProperties:false`) ya garantiza que nunca llegue
     * email/phone/photoUrl/kycStatus/roles/accountStatus acá.
     */
    async updateProfile(userId: string, input: UpdateProfileInput): Promise<PrivateProfile> {
      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }

      const nameChanged =
        (input.firstName !== undefined && input.firstName !== user.firstName) ||
        (input.lastName !== undefined && input.lastName !== user.lastName);

      // Decisión de refinamiento (MOVO-133): el nombre ya quedó validado contra el
      // documento por Didit (MOVO-72) cuando se aprueba el KYC de identidad --
      // permitir cambiarlo después rompería esa garantía. Reenviar el mismo nombre que
      // ya tiene no cuenta como cambio (nameChanged en false), así que no rompe con un
      // PATCH idempotente.
      if (nameChanged && user.kycStatusIdentity === KycStatus.APPROVED) {
        throw new ApiError(
          409,
          "PROFILE_NAME_LOCKED_BY_KYC",
          "El nombre no se puede modificar porque el KYC de identidad ya fue aprobado."
        );
      }

      const updated = await repository.updateProfile(userId, input);
      if (!updated) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      return toPrivateProfile(updated);
    },

    /**
     * MOVO-133, paso 1 de cambio de teléfono: el OTP viaja al teléfono NUEVO (prueba
     * de posesión) -- a diferencia del registro (MOVO-71/72), acá no hay
     * `phoneVerificationToken` intermedio: verificar el OTP en el paso 2 persiste
     * `phone`/`phoneVerified` directo, porque el caller ya está autenticado.
     */
    async requestPhoneChange(userId: string, phone: string): Promise<{ otpId: string; cooldownSeconds: number; sent: boolean }> {
      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }

      const normalizedPhone = normalizePhoneToE164Ar(phone);
      if (normalizedPhone === user.phone) {
        throw new ApiError(400, "VALIDATION_FAILED", "El teléfono nuevo es igual al actual.");
      }

      const existing = await repository.findByPhone(normalizedPhone);
      if (existing) {
        throw new ApiError(409, "PHONE_ALREADY_IN_USE", PHONE_ALREADY_IN_USE_MESSAGE);
      }

      return otpService.generateOtp(PHONE_CHANGE_FLOW, normalizedPhone, { userId });
    },

    /**
     * MOVO-133, paso 2: el `target` del OTP verificado ES el teléfono nuevo. El
     * `flow` esperado (`PHONE_CHANGE_FLOW`) hace que `verifyOtp` rechace de plano un
     * otpId real pero emitido para otro flujo (ej. el paso 1 de cambio de email) --
     * antes esto se "aceptaba" y terminaba cambiando el teléfono al mismo que ya
     * tenía la cuenta, consumiendo en el camino el OTP del otro flujo (review de
     * tmvergara sobre PR #91).
     */
    async verifyPhoneChange(userId: string, otpId: string, code: string): Promise<PrivateProfile> {
      const { target: newPhone } = await otpService.verifyOtp(otpId, code, PHONE_CHANGE_FLOW);

      try {
        const updated = await repository.updatePhone(userId, newPhone);
        if (!updated) {
          throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
        }
        return toPrivateProfile(updated);
      } catch (err) {
        // AC5: el teléfono pudo quedar tomado por otra cuenta entre el paso 1 y este
        // UPDATE (carrera de unicidad) -- capturado acá, nunca un 500.
        if (err instanceof UserConflictError) {
          throw new ApiError(409, "PHONE_ALREADY_IN_USE", PHONE_ALREADY_IN_USE_MESSAGE);
        }
        throw err;
      }
    },

    /**
     * MOVO-139, paso 1 de verificación del email ACTUAL: manda el OTP a la dirección
     * que la cuenta ya tiene. Es el CTA de la pantalla de perfil para los usuarios que
     * se registraron antes de que existiera este flujo (todos quedaron en
     * `email_verified = false` por backfill natural).
     */
    async requestEmailVerification(userId: string): Promise<{ otpId: string; cooldownSeconds: number; sent: boolean }> {
      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      if (user.emailVerified) {
        // AC2: no se gasta un envío en reverificar algo ya verificado.
        throw new ApiError(400, "VALIDATION_FAILED", "El email ya está verificado.");
      }

      return otpService.generateOtp(EMAIL_VERIFY_FLOW, user.email, { userId }, "email");
    },

    /**
     * MOVO-139, paso 2 de verificación del email actual: el `target` del OTP ES el
     * email de la cuenta, así que verificarlo prueba propiedad de esa dirección (AC3).
     * No cambia el email -- solo lo marca verificado.
     */
    async confirmEmailVerification(userId: string, otpId: string, code: string): Promise<PrivateProfile> {
      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }

      const { target: verifiedEmail } = await otpService.verifyOtp(otpId, code, EMAIL_VERIFY_FLOW);
      if (verifiedEmail.toLowerCase() !== user.email.toLowerCase()) {
        // Defensa en profundidad: el email de la cuenta cambió entre el paso 1 y este
        // confirm (ej. un cambio de email corrió en el medio) -- el OTP ya no prueba
        // propiedad de la dirección vigente. Mismo 401 genérico que un código
        // inválido, no distingue el motivo (mismo criterio que `verifyPhoneChange`).
        throw new ApiError(401, "AUTH_OTP_INVALID", OTP_INVALID_MESSAGE);
      }

      const updated = await repository.markEmailVerified(userId);
      if (!updated) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      return toPrivateProfile(updated);
    },

    /**
     * MOVO-139, paso 1 de cambio de email: el OTP va al email NUEVO (prueba de
     * propiedad), corrigiendo la decisión de refinamiento de MOVO-133 -- que lo mandaba
     * al teléfono actual porque el proyecto no tenía ningún `EmailProvider`. Eso probaba
     * posesión de la cuenta pero no propiedad del email, así que se podía dejar como
     * email de la cuenta una dirección ajena; con MOVO-64 (recuperación de contraseña
     * por email) eso deja de ser un dato de contacto y pasa a ser un vector de
     * recuperación. Mismo criterio que `requestPhoneChange` desde MOVO-133.
     *
     * El email candidato sigue viajando como metadata del propio OTP
     * (`meta.pendingEmail`, `otp-repository.ts`) -- comparte TTL, rotación e
     * invalidación con el OTP por construcción. Antes vivía en una key Redis paralela
     * (`pending-email-repository.ts`, borrada en MOVO-133) cuyo TTL nunca se refrescaba
     * en un reenvío (`POST /auth/resend-otp`, público): pedir un código nuevo cerca del
     * vencimiento dejaba el OTP vivo pero el email candidato ya vencido, y el verify
     * fallaba con un código que en realidad era válido (review de tmvergara sobre PR #91).
     */
    async requestEmailChange(userId: string, email: string): Promise<{ otpId: string; cooldownSeconds: number; sent: boolean }> {
      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedEmail === user.email.toLowerCase()) {
        throw new ApiError(400, "VALIDATION_FAILED", "El email nuevo es igual al actual.");
      }

      // Unicidad case-insensitive (existe `users_email_lower_idx`, MOVO-93) -- el
      // índice único real de la columna es case-sensitive, por eso este chequeo
      // explícito no puede delegarse solo en el UPDATE final.
      const existing = await repository.findByEmail(normalizedEmail);
      if (existing) {
        throw new ApiError(409, "EMAIL_ALREADY_IN_USE", EMAIL_ALREADY_IN_USE_MESSAGE);
      }

      return otpService.generateOtp(
        EMAIL_CHANGE_FLOW,
        normalizedEmail,
        { userId, pendingEmail: normalizedEmail, previousEmail: user.email },
        "email"
      );
    },

    /**
     * MOVO-139, paso 2 de cambio de email: el `target` del OTP ES el email nuevo --
     * verificarlo prueba propiedad de esa dirección, y por eso `email` y
     * `emailVerified=true` se persisten juntos en el mismo UPDATE (AC4, mismo criterio
     * que `phone`/`phoneVerified` en `verifyPhoneChange`). No revoca sesiones (el email
     * no es credencial de sesión, a diferencia de la contraseña -- ver MOVO-134).
     * `flow` esperado (`EMAIL_CHANGE_FLOW`) cierra el mismo cruce entre flujos que
     * `verifyPhoneChange` (ver su docstring): un OTP de `email-verify` no sirve acá.
     */
    async verifyEmailChange(userId: string, otpId: string, code: string): Promise<PrivateProfile> {
      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }

      const { target: verifiedEmail, meta } = await otpService.verifyOtp(otpId, code, EMAIL_CHANGE_FLOW);

      const pendingEmail = meta.pendingEmail;
      if (!pendingEmail || pendingEmail !== verifiedEmail) {
        // El target verificado y el email candidato tienen que ser el mismo valor: si
        // difirieran, se estaría persistiendo una dirección cuya propiedad nadie probó.
        throw new ApiError(401, "AUTH_OTP_INVALID", OTP_INVALID_MESSAGE);
      }

      // Re-chequeo de unicidad case-insensitive (AC5): cubre una colisión aparecida
      // recién entre el paso 1 y este verify. El OTP ya se consumió arriba
      // (verifyOtp lo invalida antes de devolver) -- este flujo no se puede
      // reintentar con este otpId pase lo que pase de acá en más, así que no hay
      // ninguna key de metadata que limpiar aparte (a diferencia de la
      // `pendingEmailRepository` que reemplaza este fix, que sobrevivía en Redis
      // hasta su TTL en cualquier rama que no fuera el éxito final).
      const existing = await repository.findByEmail(pendingEmail);
      if (existing && existing.id !== userId) {
        throw new ApiError(409, "EMAIL_ALREADY_IN_USE", EMAIL_ALREADY_IN_USE_MESSAGE);
      }

      try {
        const updated = await repository.updateEmail(userId, pendingEmail);
        if (!updated) {
          throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
        }
        await notifyPreviousEmailOfChange(user.email, pendingEmail);
        return toPrivateProfile(updated);
      } catch (err) {
        if (err instanceof UserConflictError) {
          throw new ApiError(409, "EMAIL_ALREADY_IN_USE", EMAIL_ALREADY_IN_USE_MESSAGE);
        }
        throw err;
      }
    },
  };

  /**
   * AC5 de MOVO-139: aviso al email ANTERIOR -- cierra la limitación que MOVO-133 dejó
   * documentada ("sin EmailProvider no se puede notificar al email anterior"). Sirve
   * para que el dueño real de la cuenta se entere si el cambio no lo hizo él.
   *
   * Best-effort a propósito: el cambio ya está persistido y el OTP ya se consumió, así
   * que un fallo de Resend acá no puede revertir nada -- devolver 500 le mostraría al
   * usuario un error sobre una operación que en realidad salió bien, y reintentarla
   * fallaría con "el email nuevo es igual al actual". Se loguea y sigue.
   */
  async function notifyPreviousEmailOfChange(previousEmail: string, newEmail: string): Promise<void> {
    const { subject, text, html } = buildEmailChangedNotice(newEmail);
    try {
      await emailProvider.send(previousEmail, subject, { text, html });
    } catch (err) {
      logger.error({ err }, "No se pudo notificar al email anterior sobre el cambio de email");
    }
  }
}
