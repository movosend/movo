import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createAuthService, RegisterUserInput, LoginUserInput } from "./auth.service";
import { authSchemas } from "./auth.schema";

export default async function authRoutes(app: FastifyInstance) {
  const service = createAuthService(app.db, app.redis);

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
