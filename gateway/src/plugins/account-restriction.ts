import fp from "fastify-plugin";
import { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError, accountRestrictionKey } from "@movo/shared";
import { isSuspendedBlockedRoute } from "../config/routes-map";

declare module "fastify" {
  interface FastifyInstance {
    /** `path` sin `API_PREFIX`. Tira 403 si la cuenta está inhabilitada, o suspendida y la acción está bloqueada. */
    enforceAccountRestriction: (request: FastifyRequest, path: string) => Promise<void>;
  }
}

/**
 * MOVO-298: aplica la marca `account:restriction:<userId>` que escribe `svc-users` (MOVO-296).
 * Va después de `authenticate`. Una suspensión con fin trae TTL = tiempo que falta, así que
 * la fecha de fin se calcula con PTTL y la marca vencida desaparece sola; sin TTL es
 * indefinida (`endsAt: null`).
 */
export default fp(async (app: FastifyInstance) => {
  app.decorate("enforceAccountRestriction", async (request: FastifyRequest, path: string) => {
    const userId = request.user!.sub;
    const key = accountRestrictionKey(userId);

    let mark: string | null;
    let pttl: number;
    try {
      const results = await app.redis.multi().get(key).pttl(key).exec();
      const [getResult, pttlResult] = results ?? [];
      if (!getResult || !pttlResult || getResult[0] || pttlResult[0]) {
        throw getResult?.[0] ?? pttlResult?.[0] ?? new Error("Redis MULTI sin resultado");
      }
      mark = getResult[1] as string | null;
      pttl = pttlResult[1] as number;
    } catch (error) {
      // Falla abierto: con Redis caído tampoco andan el refresh ni el rate limit, así que
      // bloquear acá no protege nada extra y sí le cortaría la app a todos los usuarios.
      request.log.error({ err: error, userId }, "No se pudo leer la marca de restricción de la cuenta; se deja pasar");
      return;
    }

    if (mark === "disabled") {
      throw new ApiError(403, "ACCOUNT_DISABLED", "Your account has been disabled.");
    }
    if (mark === "suspended" && isSuspendedBlockedRoute(request.method, path)) {
      const endsAt = pttl > 0 ? new Date(Date.now() + pttl).toISOString() : null;
      throw new ApiError(403, "ACCOUNT_SUSPENDED", "Your account is suspended and cannot perform this action.", {
        endsAt,
      });
    }
  });
});
