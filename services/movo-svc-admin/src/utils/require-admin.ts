import { FastifyRequest } from "fastify";
import { ApiError, UserRole } from "@movo/shared";
import { requireUserIdFromHeader } from "./require-user-id";
import { getUserRolesFromHeader } from "./get-user-roles";

/**
 * Devuelve el id del admin que hace el request. El gateway ya exige el rol `admin` en todo
 * `/admin/*` (MOVO-288); esto es defensa en profundidad por si alguna ruta queda montada
 * fuera de ese prefijo o se llama desde la red interna.
 */
export function requireAdmin(request: FastifyRequest): string {
  const adminId = requireUserIdFromHeader(request);
  if (!getUserRolesFromHeader(request).includes(UserRole.ADMIN)) {
    throw new ApiError(403, "AUTH_FORBIDDEN", `Required role: ${UserRole.ADMIN}`);
  }
  return adminId;
}
