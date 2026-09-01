import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";
import { createUsersService, PhotoUploadUrlInput, RegisterPushTokenInput, UpdateProfileInput } from "./users.service";
import { usersSchemas } from "./users.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { createStorageProvider, StorageProvider } from "../../adapters/storage-provider";
import { createShipmentsClient, ShipmentsClient } from "../../adapters/shipments-client";
import { createSmsProvider, SmsProvider } from "../../adapters/sms-provider";
import { createEmailProvider, EmailProvider } from "../../adapters/email-provider";
import { createOtpRepository } from "../../repositories/otp-repository";
import { createOtpService } from "../../services/otp-service";

export interface UsersRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración — evita depender de un bucket real/
   * credenciales de AWS (MOVO-97), mismo criterio que `geocodingProvider`/`diditClient`. */
  storageProvider?: StorageProvider;
  /** Override solo para tests de integración — evita depender de un `movo-svc-shipments`
   * real levantado (MOVO-134), mismo criterio que `storageProvider`. */
  shipmentsClient?: ShipmentsClient;
  /** Override solo para tests de integración — mismo criterio que `auth.routes.ts`
   * (MOVO-133 reusa el motor de OTP para el cambio de teléfono/email). */
  smsProvider?: SmsProvider;
  /** Override solo para tests de integración — mismo criterio que `smsProvider`
   * (MOVO-139: el OTP de email y el aviso al email anterior salen por este proveedor). */
  emailProvider?: EmailProvider;
}

export default async function usersRoutes(app: FastifyInstance, opts: UsersRoutesOptions) {
  const storageProvider = opts.storageProvider ?? createStorageProvider(app.config);
  const shipmentsClient = opts.shipmentsClient ?? createShipmentsClient(app.config);
  const smsProvider = opts.smsProvider ?? createSmsProvider(app.config);
  const emailProvider = opts.emailProvider ?? createEmailProvider(app.config);
  const otpRepository = createOtpRepository(app.redis);
  const otpService = createOtpService(otpRepository, { sms: smsProvider, email: emailProvider });
  const service = createUsersService(
    app.db,
    storageProvider,
    app.log,
    app.redis,
    shipmentsClient,
    otpService,
    emailProvider,
    app.config.REPUTATION_CACHE_TTL_SECONDS
  );

  app.get(
    "/count",
    { schema: { response: { 200: usersSchemas.usersCountResponse } } },
    async () => {
      const count = await service.getUsersCount();
      return { count };
    },
  );

  app.get(
    "/me",
    {
      schema: {
        summary: "Perfil propio",
        description:
          "Devuelve el perfil privado completo del usuario autenticado (AC1): nombre, " +
          "email, teléfono, foto, kycStatus, accountStatus, roles, insignias, contadores " +
          "de transacciones y score de reputación. Ruta protegida: el userId se deriva " +
          "del header x-user-id inyectado por el gateway (ADR-010).",
        tags: ["users"],
        response: {
          200: usersSchemas.privateProfileResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      return service.getPrivateProfile(userId);
    },
  );

  app.post(
    "/me/password",
    {
      schema: {
        summary: "Cambiar la contraseña propia",
        description:
          "MOVO-134: verifica currentPassword contra argon2 (401 si no coincide), " +
          "aplica la política de contraseña del registro a newPassword, revoca todas " +
          "las sesiones y devuelve un par de tokens nuevo (mismo shape que login) -- " +
          "quien hizo el cambio no queda deslogueado, el resto de los dispositivos sí. " +
          "Rate limit por usuario (5 intentos / 15 min), independiente del rate " +
          "limiting por IP del gateway.",
        tags: ["users"],
        body: usersSchemas.changePasswordBody,
        response: {
          200: usersSchemas.changePasswordResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
          429: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };
      return service.changePassword(userId, currentPassword, newPassword);
    },
  );

  app.delete(
    "/me",
    {
      schema: {
        summary: "Dar de baja la cuenta propia",
        description:
          "MOVO-134: confirma con password (no alcanza con el JWT). Bloquea con 409 " +
          "ACCOUNT_HAS_ACTIVE_DISPUTES/ACCOUNT_HAS_ACTIVE_SHIPMENTS si el usuario " +
          "(como emisor, receptor o transportista) tiene una disputa o un envío en un " +
          "estado no terminal -- sin cascada de cancelación, el usuario cancela por su " +
          "cuenta y reintenta. Si no hay nada bloqueante: soft-delete + anonimización " +
          "de PII, revoca sesiones, borra push tokens/direcciones y la foto de S3. " +
          "Idempotente -- una cuenta ya deleted responde 204 sin efectos.",
        tags: ["users"],
        body: usersSchemas.deleteAccountBody,
        response: {
          204: { type: "null", description: "Sin contenido" },
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
          409: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = requireUserIdFromHeader(request);
      const { password } = request.body as { password: string };
      await service.deleteAccount(userId, password);
      reply.code(204);
    },
  );

  app.patch(
    "/me",
    {
      // Fastify trae `removeAdditional: true` como default de AJV (mismo gotcha
      // documentado en el CLAUDE.md de MOVO-129 de svc-shipments): con solo
      // `additionalProperties:false` en el schema, un campo de más (`email`, `roles`,
      // etc.) se descarta en silencio en vez de devolver 400 -- este `preValidation`
      // corre ANTES de esa fase y rechaza explícitamente cualquier clave que no sea
      // firstName/lastName (AC2), sin tocar la configuración global de AJV del resto
      // del servicio.
      preValidation: async (request: FastifyRequest) => {
        const body = request.body as Record<string, unknown> | undefined;
        const allowedKeys = new Set(["firstName", "lastName"]);
        if (body && Object.keys(body).some((key) => !allowedKeys.has(key))) {
          throw new ApiError(400, "VALIDATION_FAILED", "Solo se puede editar firstName/lastName por esta vía.");
        }
      },
      schema: {
        summary: "Actualizar datos personales propios",
        description:
          "AC1/AC2/AC3 de MOVO-133: actualización parcial de nombre/apellido. " +
          "Mandar email/phone/photoUrl/kycStatus/roles/accountStatus es 400 " +
          "VALIDATION_FAILED (esos campos no se editan acá). Body vacío `{}` " +
          "también es 400 (`minProperties:1`). Bloqueado con 409 " +
          "PROFILE_NAME_LOCKED_BY_KYC si el KYC de identidad ya está aprobado -- " +
          "el nombre quedó validado contra el documento por Didit (MOVO-72).",
        tags: ["users"],
        body: usersSchemas.patchProfileBody,
        response: {
          200: usersSchemas.privateProfileResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
          409: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const body = request.body as UpdateProfileInput;
      return service.updateProfile(userId, body);
    },
  );

  app.post(
    "/me/phone/change/otp",
    {
      schema: {
        summary: "Solicitar cambio de teléfono (paso 1: OTP al nuevo)",
        description:
          "MOVO-133: envía un OTP al teléfono NUEVO (prueba de posesión). Protegida " +
          "por JWT, a diferencia de POST /auth/send-otp (pública) -- pero el split " +
          "200/409 sigue dejando enumerar teléfonos registrados a cualquier usuario " +
          "logueado, la protección real es el rate limit propio del gateway (5/15min, " +
          "más caro que el general por mandar SMS reales). 409 PHONE_ALREADY_IN_USE " +
          "si el teléfono ya pertenece a otra cuenta, 400 si es el mismo que ya " +
          "tiene. Reenvío: POST /auth/resend-otp con el mismo otpId.",
        tags: ["users"],
        body: usersSchemas.phoneChangeOtpBody,
        response: {
          200: usersSchemas.otpRequestResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
          409: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { phone } = request.body as { phone: string };
      return service.requestPhoneChange(userId, phone);
    },
  );

  app.post(
    "/me/phone/change/verify",
    {
      schema: {
        summary: "Confirmar cambio de teléfono (paso 2: verificar OTP)",
        description:
          "MOVO-133: el target del OTP ES el teléfono nuevo -- verificarlo prueba " +
          "posesión y persiste phone + phoneVerified=true en el mismo UPDATE. 401 " +
          "AUTH_OTP_INVALID ante código malo/reusado, 422 AUTH_OTP_EXPIRED si venció.",
        tags: ["users"],
        body: usersSchemas.otpVerifyBody,
        response: {
          200: usersSchemas.privateProfileResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
          409: usersSchemas.errorResponse,
          422: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { otpId, code } = request.body as { otpId: string; code: string };
      return service.verifyPhoneChange(userId, otpId, code);
    },
  );

  app.post(
    "/me/email/verify/otp",
    {
      schema: {
        summary: "Verificar el email actual (paso 1: OTP al email de la cuenta)",
        description:
          "MOVO-139: manda un código a la dirección que la cuenta YA tiene, para " +
          "probar que le pertenece. Sin body. 400 si el email ya está verificado. " +
          "Reenvío: POST /auth/resend-otp con el mismo otpId. Rate limit propio en el " +
          "gateway (5/15min), igual que los dos endpoints de cambio.",
        tags: ["users"],
        response: {
          200: usersSchemas.otpRequestResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      return service.requestEmailVerification(userId);
    },
  );

  app.post(
    "/me/email/verify/confirm",
    {
      schema: {
        summary: "Verificar el email actual (paso 2: confirmar OTP)",
        description:
          "MOVO-139: el target del OTP ES el email de la cuenta, así que verificarlo " +
          "prueba propiedad. Persiste emailVerified=true (+ email_verified_at, solo " +
          "auditoría) y devuelve el PrivateProfile actualizado. No cambia el email. " +
          "401 AUTH_OTP_INVALID ante código malo/reusado, 422 AUTH_OTP_EXPIRED si venció.",
        tags: ["users"],
        body: usersSchemas.otpVerifyBody,
        response: {
          200: usersSchemas.privateProfileResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
          422: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { otpId, code } = request.body as { otpId: string; code: string };
      return service.confirmEmailVerification(userId, otpId, code);
    },
  );

  app.post(
    "/me/email/change/otp",
    {
      schema: {
        summary: "Solicitar cambio de email (paso 1: OTP al email nuevo)",
        description:
          "MOVO-139: el OTP va al email NUEVO (prueba de propiedad), corrigiendo la " +
          "decisión de refinamiento de MOVO-133 -- que lo mandaba al teléfono actual " +
          "por no haber ningún EmailProvider en el proyecto. 409 EMAIL_ALREADY_IN_USE " +
          "si el email ya pertenece a otra cuenta (chequeo case-insensitive), 400 si " +
          "es el mismo que ya tiene.",
        tags: ["users"],
        body: usersSchemas.emailChangeOtpBody,
        response: {
          200: usersSchemas.otpRequestResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
          409: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { email } = request.body as { email: string };
      return service.requestEmailChange(userId, email);
    },
  );

  app.post(
    "/me/email/change/verify",
    {
      schema: {
        summary: "Confirmar cambio de email (paso 2: verificar OTP)",
        description:
          "MOVO-139: el target del OTP ES el email nuevo -- verificarlo prueba " +
          "propiedad, y por eso email + emailVerified=true se persisten en el mismo " +
          "UPDATE. El email pendiente viaja como metadata del propio OTP (comparte " +
          "TTL/rotación/invalidación con él). Dispara un aviso al email ANTERIOR " +
          "(best-effort: un fallo de envío no revierte el cambio ya persistido). No " +
          "revoca sesiones (el email no es credencial de sesión, a diferencia de la " +
          "contraseña -- ver ticket hermano MOVO-134).",
        tags: ["users"],
        body: usersSchemas.otpVerifyBody,
        response: {
          200: usersSchemas.privateProfileResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
          409: usersSchemas.errorResponse,
          422: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { otpId, code } = request.body as { otpId: string; code: string };
      return service.verifyEmailChange(userId, otpId, code);
    },
  );

  // Ruta estática — se registra antes de "/:id" para que no haya ambigüedad visual
  // con el próximo lector del archivo (el radix router de Fastify ya resuelve esto
  // bien sin importar el orden de registro).
  app.get(
    "/search",
    {
      schema: {
        summary: "Buscar usuarios por nombre completo",
        description:
          "AC3 de MOVO-80: busca por firstName+lastName (substring, case-insensitive) " +
          "-- nunca por email/teléfono, evita enumeración. Devuelve la proyección " +
          "pública (PublicProfile[]), máximo 20 resultados, excluye al propio caller. " +
          "Ruta protegida.",
        tags: ["users"],
        querystring: usersSchemas.searchQuery,
        response: {
          200: usersSchemas.searchResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { q } = request.query as { q: string };
      return service.searchUsers(q, callerId);
    },
  );

  app.get(
    "/:id",
    {
      schema: {
        summary: "Perfil público de un usuario",
        description:
          "Devuelve la proyección pública de cualquier usuario (AC2): nombre, foto, " +
          "score de reputación, contadores de transacciones por rol e insignias. Nunca " +
          "incluye email, teléfono ni accountStatus (AC3) — kycStatus se expone solo " +
          "como el booleano isVerified (AC4). Ruta protegida (AC8); requiere " +
          "autenticación pero no usa el userId propio del caller.",
        tags: ["users"],
        params: usersSchemas.userIdParam,
        response: {
          200: usersSchemas.publicProfileResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      return service.getPublicProfile(id);
    },
  );

  app.post(
    "/me/photo/upload-url",
    {
      schema: {
        summary: "Presigned URL para subir foto de perfil",
        description:
          "AC1/AC2/AC3 de MOVO-97: devuelve una presigned URL de PUT a S3 (TTL 5 " +
          "minutos) para el tipo/tamaño declarados — ambos quedan firmados dentro de " +
          "la URL, no solo validados acá. El objectKey lo genera el servidor bajo " +
          "profile-photos/{userId}/, nunca uno propuesto por el cliente. Ruta " +
          "protegida con rate limit propio en el gateway (AC8).",
        tags: ["users"],
        body: usersSchemas.photoUploadUrlBody,
        response: {
          200: usersSchemas.photoUploadUrlResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const body = request.body as PhotoUploadUrlInput;
      return service.getPhotoUploadUrl(userId, body);
    },
  );

  app.put(
    "/me/photo",
    {
      schema: {
        summary: "Confirmar foto de perfil subida",
        description:
          "AC4/AC5/AC6 de MOVO-97: verifica contra S3 (HEAD) que el objeto exista y " +
          "esté dentro de lo permitido, persiste photo_url y borra (best-effort) la " +
          "foto anterior si había una. Mientras esta confirmación no ocurra, " +
          "photo_url no cambia.",
        tags: ["users"],
        body: usersSchemas.confirmPhotoBody,
        response: {
          200: usersSchemas.confirmPhotoResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          403: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
          422: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { objectKey } = request.body as { objectKey: string };
      return service.confirmPhoto(userId, objectKey);
    },
  );

  app.delete(
    "/me/photo",
    {
      schema: {
        summary: "Borrar foto de perfil",
        description:
          "AC7 de MOVO-97: deja photo_url en null y borra el objeto de S3. " +
          "Idempotente — sin foto previa también responde 204.",
        tags: ["users"],
        response: {
          204: { type: "null", description: "Sin contenido" },
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = requireUserIdFromHeader(request);
      await service.deletePhoto(userId);
      reply.code(204);
    },
  );

  app.post(
    "/me/push-token",
    {
      schema: {
        summary: "Registrar push token del dispositivo",
        description:
          "AC1/AC2 de MOVO-106: upsert por (user_id, device_id) — un dispositivo tiene " +
          "un solo token vigente por usuario, permite multi-dispositivo. El userId sale " +
          "del header x-user-id inyectado por el gateway (ADR-010), nunca del body.",
        tags: ["users"],
        body: usersSchemas.registerPushTokenBody,
        response: {
          200: usersSchemas.registerPushTokenResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const body = request.body as RegisterPushTokenInput;
      return service.registerPushToken(userId, body);
    },
  );

  app.delete(
    "/me/push-token",
    {
      schema: {
        summary: "Borrar push token de un dispositivo",
        description:
          "AC3 de MOVO-106: borra el token del dispositivo indicado para el usuario " +
          "autenticado. Idempotente — sin token previo también responde 204.",
        tags: ["users"],
        body: usersSchemas.unregisterPushTokenBody,
        response: {
          204: { type: "null", description: "Sin contenido" },
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = requireUserIdFromHeader(request);
      const { deviceId } = request.body as { deviceId: string };
      await service.unregisterPushToken(userId, deviceId);
      reply.code(204);
    },
  );

  app.post(
    "/me/device-key",
    {
      schema: {
        summary: "Registrar/rotar la clave pública del dispositivo",
        description:
          "AC2/AC5 de MOVO-157: registra la clave pública del par asimétrico generado " +
          "client-side (la privada nunca viaja, AC1) -- prerrequisito del handshake " +
          "criptográfico de MOVO-6/158. Un registro nuevo reemplaza al anterior: solo " +
          "una clave vigente por usuario, sin necesidad de un endpoint de borrado.",
        tags: ["users"],
        body: usersSchemas.registerDeviceKeyBody,
        response: {
          200: usersSchemas.registerDeviceKeyResponse,
          400: usersSchemas.errorResponse,
          401: usersSchemas.errorResponse,
          404: usersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { publicKey } = request.body as { publicKey: string };
      const { registeredAt } = await service.registerDeviceKey(userId, publicKey);
      return { registeredAt: registeredAt.toISOString() };
    },
  );
}
