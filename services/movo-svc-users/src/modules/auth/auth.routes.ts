import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { createAuthService, RegisterUserInput, LoginUserInput } from "./auth.service";
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

export default async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions) {
  const smsProvider = opts.smsProvider ?? createSmsProvider(app.config);
  const otpRepository = createOtpRepository(app.redis);
  const otpService = createOtpService(otpRepository, smsProvider);
  const phoneVerificationService = createPhoneVerificationService(otpService, app.redis, app.config.JWT_SECRET);

  const service = createAuthService(app.db, app.redis, phoneVerificationService);

  app.post<{ Body: RegisterUserInput }>(
    "/register",
    {
      schema: {
        summary: "Registro de usuario",
        description:
          "Crea un usuario con roles emisor y transportista por defecto. Exige un " +
          "phoneVerificationToken vigente (POST /auth/verify-otp) — se consume acá y " +
          "el usuario queda persistido con el teléfono ya verificado. No emite tokens " +
          "de sesión: el login es un paso separado (POST /auth/login).",
        tags: ["auth"],
        body: authSchemas.registerBody,
        response: {
          201: authSchemas.registerResponse,
          400: authSchemas.errorResponse,
          401: authSchemas.errorResponse,
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
          "refresh token opaco persistido en Redis (7 días TTL).",
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
}
