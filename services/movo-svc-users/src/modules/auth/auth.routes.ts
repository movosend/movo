import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";
import { createAuthService, RegisterUserInput, LoginUserInput, LogoutInput } from "./auth.service";
import { authSchemas } from "./auth.schema";
import { createOtpRepository } from "../../repositories/otp-repository";
import { createOtpService } from "../../services/otp-service";
import { createSmsProvider, SmsProvider } from "../../adapters/sms-provider";
import { createPhoneVerificationService } from "./phone-verification.service";

export interface AuthRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests — evita depender de logs de consola para leer el código
   * generado, ya que el código nunca sale por HTTP (DoD de MOVO-71). */
  smsProvider?: SmsProvider;
}

interface SendOtpBody {
  phone: string;
}

interface VerifyOtpBody {
  otpId: string;
  code: string;
}

interface ResendOtpBody {
  otpId: string;
}

interface RefreshBody {
  refreshToken: string;
}

export default async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions) {
  const service = createAuthService(app.db, app.redis);

  const smsProvider = opts.smsProvider ?? createSmsProvider(app.config);
  const otpRepository = createOtpRepository(app.redis);
  const otpService = createOtpService(otpRepository, smsProvider);
  const phoneVerificationService = createPhoneVerificationService(otpService, app.redis, app.config.JWT_SECRET);

  app.post<{ Body: RegisterUserInput }>(
    "/register",
    {
      schema: {
        summary: "Registro de usuario",
        description:
          "Crea un usuario con roles emisor y transportista por defecto. No emite tokens: " +
          "el usuario todavía no verificó el teléfono ni completó el KYC.",
        tags: ["auth"],
        body: authSchemas.registerBody,
        response: {
          201: authSchemas.registerResponse,
          400: authSchemas.errorResponse,
          409: authSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: RegisterUserInput }>, reply: FastifyReply) => {
      const result = await service.register(request.body);
      reply.code(201);
      return result;
    }
  );

  app.post<{ Body: SendOtpBody }>(
    "/send-otp",
    {
      schema: {
        summary: "Enviar código OTP a un teléfono",
        description:
          "Genera un código de 6 dígitos y lo envía por SMS al teléfono indicado — " +
          "todavía sin cuenta creada (MOVO-71). Si se llama dentro del cooldown de un " +
          "envío previo, devuelve el mismo otpId sin mandar un SMS nuevo.",
        tags: ["auth"],
        body: authSchemas.sendOtpBody,
        response: {
          200: authSchemas.sendOtpResponse,
          400: authSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: SendOtpBody }>, reply: FastifyReply) => {
      const result = await phoneVerificationService.sendOtp(request.body.phone);
      reply.code(200);
      return result;
    }
  );

  app.post<{ Body: VerifyOtpBody }>(
    "/verify-otp",
    {
      schema: {
        summary: "Verificar código OTP",
        description:
          "Valida el código contra el otpId. Si es correcto, devuelve un " +
          "phoneVerificationToken de corta duración y un solo uso, para pasar en el " +
          "body de POST /auth/register.",
        tags: ["auth"],
        body: authSchemas.verifyOtpBody,
        response: {
          200: authSchemas.verifyOtpResponse,
          400: authSchemas.errorResponse,
          401: authSchemas.errorResponse,
          422: authSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: VerifyOtpBody }>, reply: FastifyReply) => {
      const result = await phoneVerificationService.verifyOtp(request.body.otpId, request.body.code);
      reply.code(200);
      return result;
    }
  );

  app.post<{ Body: ResendOtpBody }>(
    "/resend-otp",
    {
      schema: {
        summary: "Reenviar código OTP",
        description:
          "Genera un código nuevo bajo el mismo otpId (el hash del anterior no permite " +
          "reenviar el mismo código tal cual) y lo manda por SMS. Cooldown mínimo de " +
          "60 segundos entre solicitudes.",
        tags: ["auth"],
        body: authSchemas.resendOtpBody,
        response: {
          200: authSchemas.resendOtpResponse,
          400: authSchemas.errorResponse,
          422: authSchemas.errorResponse,
          429: authSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: ResendOtpBody }>, reply: FastifyReply) => {
      const result = await phoneVerificationService.resendOtp(request.body.otpId);
      reply.code(200);
      return result;
    }
  );

  app.post<{ Body: LoginUserInput }>(
    "/login",
    {
      schema: {
        summary: "Autenticación de usuario",
        description:
          "Autentica con teléfono y contraseña. Emite JWT access token (60min TTL) y " +
          "refresh token opaco persistido en Redis (90 días TTL, ADR-013).",
        tags: ["auth"],
        body: authSchemas.loginBody,
        response: {
          200: authSchemas.loginResponse,
          400: authSchemas.errorResponse,
          401: authSchemas.errorResponse,
          403: authSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: LoginUserInput }>, reply: FastifyReply) => {
      const result = await service.login(request.body);
      reply.code(200);
      return result;
    }
  );

  app.post<{ Body: RefreshBody }>(
    "/refresh",
    {
      schema: {
        summary: "Renovar access token",
        description:
          "Recibe el refresh token vigente y devuelve un par de tokens nuevo. El " +
          "refresh es de un solo uso (rotación): reusar uno ya canjeado revoca todas " +
          "las sesiones del usuario. El access token anterior, si todavía no expiró, " +
          "sigue siendo válido hasta su expiración natural (60min, ADR-004) — no hay " +
          "forma de invalidarlo antes, el cliente debe descartarlo del lado suyo.",
        tags: ["auth"],
        body: authSchemas.refreshBody,
        response: {
          200: authSchemas.refreshResponse,
          400: authSchemas.errorResponse,
          401: authSchemas.errorResponse,
          403: authSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
      const result = await service.refresh(request.body.refreshToken);
      reply.code(200);
      return result;
    }
  );

  app.post<{ Body: LogoutInput }>(
    "/logout",
    {
      schema: {
        summary: "Cerrar la sesión actual",
        description:
          "Revoca el refresh token de la sesión actual. Ruta protegida: requiere el " +
          "access token vigente (identifica al usuario vía x-user-id, inyectado por el " +
          "gateway). Idempotente — llamarla dos veces no da error. El access token " +
          "sigue siendo válido hasta su expiración natural (60min, ADR-004); el " +
          "cliente debe borrarlo de su storage para que el logout sea efectivo de inmediato.",
        tags: ["auth"],
        body: authSchemas.logoutBody,
        response: {
          204: { type: "null" },
        },
      },
    },
    async (request: FastifyRequest<{ Body: LogoutInput }>, reply: FastifyReply) => {
      const userId = request.headers["x-user-id"];
      if (typeof userId !== "string" || !userId) {
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Missing or invalid authorization header");
      }
      await service.logout(request.body, userId);
      reply.code(204);
      return null;
    }
  );

  app.post(
    "/logout-all",
    {
      schema: {
        summary: "Cerrar todas las sesiones del usuario",
        description:
          "Revoca todos los refresh tokens del usuario autenticado. Ruta protegida, " +
          "misma nota de ADR-004 que /auth/logout sobre el access token vigente.",
        tags: ["auth"],
        response: {
          204: { type: "null" },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.headers["x-user-id"];
      if (typeof userId !== "string" || !userId) {
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Missing or invalid authorization header");
      }
      await service.logoutAll(userId);
      reply.code(204);
      return null;
    }
  );
}
