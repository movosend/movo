import fp from "fastify-plugin";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  verifyAccessToken,
  ApiError,
  type AccessTokenClaims,
  type UserRole,
} from "@movo/shared";

declare module "fastify" {
  interface FastifyRequest {
    user?: AccessTokenClaims;
  }

  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    authorize: (
      roles: UserRole[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app: FastifyInstance) => {
  app.decorate("authenticate", async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new ApiError(
        401,
        "AUTH_TOKEN_INVALID",
        "Missing or invalid authorization header"
      );
    }

    const token = authHeader.slice(7);
    const result = verifyAccessToken(token);

    if (result.status === "invalid") {
      if (result.reason === "expired") {
        throw new ApiError(401, "AUTH_TOKEN_EXPIRED", "Token has expired");
      }
      throw new ApiError(
        401,
        "AUTH_TOKEN_INVALID",
        "Invalid or malformed token"
      );
    }

    // MOVO-134 (review de tmvergara sobre el PR de cambio de contraseña/baja de
    // cuenta): un access token es un JWT stateless (ADR-004) -- sin este chequeo,
    // sigue siendo válido hasta sus 60 minutos de TTL aunque el usuario haya
    // cambiado su contraseña o dado de baja la cuenta mientras tanto.
    // `user-revoked-at:{userId}` lo sella `movo-svc-users`
    // (`repositories/session-repository.ts#revokeAccessTokensIssuedBefore`) en
    // segundos Unix, misma unidad que el claim `iat` -- comparar contra
    // `Date.now()`/milisegundos dejaría el token recién emitido por ese mismo cambio
    // auto-revocado por el redondeo de `iat` al segundo.
    const revokedAt = await app.redis.get(`user-revoked-at:${result.claims.sub}`);
    if (revokedAt && result.claims.iat < Number(revokedAt)) {
      throw new ApiError(
        401,
        "AUTH_TOKEN_INVALID",
        "Token revoked, please log in again."
      );
    }

    request.user = result.claims;
  });

  app.decorate("authorize", (roles: UserRole[]) => {
    return async (request: FastifyRequest) => {
      if (!request.user) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "User not authenticated");
      }

      const hasRole = roles.some((role) =>
        request.user!.roles.includes(role)
      );
      if (!hasRole) {
        throw new ApiError(
          403,
          "AUTH_FORBIDDEN",
          `Required role: ${roles.join(" or ")}`
        );
      }
    };
  });
});
