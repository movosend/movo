import fp from "fastify-plugin";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  verifyAccessToken,
  ApiError,
  type AccessTokenClaims,
  UserRole,
} from "@movo/shared";
import { EnvConfig } from "../config/env";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenClaims;
    }
  }
}

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
      roles: string[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app: FastifyInstance, opts: { env: EnvConfig }) => {
  app.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
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

      request.user = result.claims;
    }
  );

  app.decorate("authorize", (roles: string[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        throw new ApiError(
          403,
          "AUTH_FORBIDDEN",
          "User not authenticated"
        );
      }

      const hasRole = roles.some((role) => request.user!.roles.includes(role as any));
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
