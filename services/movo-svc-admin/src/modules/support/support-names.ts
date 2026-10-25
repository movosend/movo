import { FastifyInstance } from "fastify";
import { RequestContext } from "../../adapters/internal-client";
import { UNKNOWN_USER_NAME } from "../users/users.routes";
import { NameDirectory } from "./support.presenter";

/**
 * MOVO-322: nombres y roles de la bandeja, best-effort: si `svc-users` no responde se muestra `UNKNOWN_USER_NAME`
 * (como la ficha) y la fila sale igual. Lo usan las rutas y el WebSocket del panel.
 */
export function createNameResolver(app: FastifyInstance) {
  return async function directory(ids: string[], ctx: RequestContext): Promise<NameDirectory> {
    const unique = [...new Set(ids)];
    let found: Array<{ id: string; fullName: string; roles: string[] }> = [];
    if (unique.length > 0) {
      try {
        found = await app.usersClient.getUserNames(unique, ctx);
      } catch (error) {
        app.log.warn({ err: error, event: "support_names_unavailable", requestId: ctx.requestId }, "No se pudieron resolver los nombres");
      }
    }
    const byId = new Map(found.map((user) => [user.id, user]));
    return { nameOf: (id) => byId.get(id)?.fullName ?? UNKNOWN_USER_NAME, rolesOf: (id) => byId.get(id)?.roles ?? [] };
  };
}
