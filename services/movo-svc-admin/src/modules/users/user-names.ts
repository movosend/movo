import { FastifyInstance } from "fastify";
import { AdminUserRef, ApiError } from "@movo/shared";
import { RequestContext } from "../../adapters/internal-client";

/** Lo que se muestra si `svc-users` no responde o el id ya no existe: la sección no falla por un nombre. */
export const UNKNOWN_USER_NAME = "Nombre no disponible";

export type NameOf = (id: string) => string;

/**
 * Nombres de las contrapartes (envíos, calificaciones) y de los admins (notas, bitácora,
 * ajustes, sanciones). Best-effort a propósito: los datos de la sección son de otro servicio, y
 * que `svc-users` no responda no debería romperla. Se loguea y se muestra `UNKNOWN_USER_NAME`.
 */
export function createNameResolver(app: FastifyInstance) {
  return async function namesOf(ids: (string | null)[], ctx: RequestContext): Promise<NameOf> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    let found: AdminUserRef[] = [];
    try {
      found = await app.usersClient.getUserNames(unique, ctx);
    } catch (error) {
      app.log.warn({ err: error, event: "admin_user_names_unavailable", requestId: ctx.requestId }, "No se pudieron resolver los nombres");
    }
    const byId = new Map(found.map((user) => [user.id, user.fullName]));
    return (id) => byId.get(id) ?? UNKNOWN_USER_NAME;
  };
}

/** El motivo se valida sin espacios: AJV mira el string crudo. */
export function requireReason(raw: string): string {
  const reason = raw.trim();
  if (!reason) throw new ApiError(400, "VALIDATION_FAILED", "El motivo es obligatorio.");
  return reason;
}
