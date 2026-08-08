import { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";
import { createUsersService } from "./users.service";
import { usersSchemas } from "./users.schema";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El `userId` sale del header `x-user-id`, inyectado por el gateway después de
 * validar el JWT (ADR-010) — mismo criterio que `kyc.routes.ts#requireUserIdFromHeader`.
 * Un valor ausente o mal formado significa que la request no pasó por el gateway como
 * se esperaba, no que el usuario no exista (eso lo resuelve el service con 404).
 */
function requireUserIdFromHeader(request: FastifyRequest): string {
  const raw = request.headers["x-user-id"];
  const userId = Array.isArray(raw) ? raw[0] : raw;
  if (!userId || !UUID_PATTERN.test(userId)) {
    throw new ApiError(401, "AUTH_TOKEN_INVALID", "Falta autenticación válida para esta operación.");
  }
  return userId;
}

export default async function usersRoutes(app: FastifyInstance) {
  const service = createUsersService(app.db);

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
}
