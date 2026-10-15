import fp from "fastify-plugin";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  verifyAccessToken,
  ApiError,
  UserRole,
  type AccessTokenClaims,
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
    //
    // MOVO-287: `panel-revoked-at:{userId}` corta las sesiones del panel sin tocar las de
    // la app (`session-repository.ts#revokePanelSessionsForUser`, misma unidad). Un token
    // es del panel solo si trae el claim `session: "panel"`, no por tener el rol `admin`
    // (review de PR #244). Las dos marcas se leen en un solo MGET.
    const isPanelToken = result.claims.session === "panel";
    const [revokedAt, panelRevokedAt] = await app.redis.mget(
      `user-revoked-at:${result.claims.sub}`,
      `panel-revoked-at:${result.claims.sub}`
    );
    // `<` y no `<=`: `changePassword()` emite un token nuevo en el mismo segundo en que
    // sella la marca, y ese token tiene que seguir valiendo.
    const revokedForUser = revokedAt !== null && result.claims.iat < Number(revokedAt);
    // `<=` en el panel: un refresh que corre en paralelo a la revocación puede firmar un
    // token en el mismo segundo que la marca, y ese no puede sobrevivir. Ninguna sesión
    // de panel legítima arranca en ese segundo (el usuario acaba de perder el acceso).
    const revokedForPanel = isPanelToken && panelRevokedAt !== null && result.claims.iat <= Number(panelRevokedAt);
    if (revokedForUser || revokedForPanel) {
      throw new ApiError(
        401,
        "AUTH_TOKEN_INVALID",
        "Token revoked, please log in again."
      );
    }

    // El rol `admin` solo vale en una sesión de panel: un token de la app que lo traiga
    // (emitido antes de MOVO-287, con 60 min de vida) lo pierde acá, así no llega a
    // `authorize` ni a `x-user-roles` (permisos de admin en svc-shipments, por ejemplo).
    request.user = isPanelToken
      ? result.claims
      : { ...result.claims, roles: result.claims.roles.filter((role) => role !== UserRole.ADMIN) };
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
