import { FastifyRequest } from "fastify";
import { UserRole } from "@movo/shared";

const VALID_ROLES: ReadonlySet<string> = new Set(Object.values(UserRole));

/**
 * El gateway inyecta `x-user-roles` (comma-joined, ej. "sender,carrier") en todo
 * request protegido (ADR-010, MOVO-68/MOVO-72). A diferencia de `x-user-id`, un
 * header ausente o malformado acá no es un fallo de autenticación — solo hace que el
 * caller no tenga ningún rol reconocido (nunca lanza), porque el único uso hoy
 * (MOVO-80) es una excepción de autorización (admin), no el gate principal.
 */
export function getUserRolesFromHeader(request: FastifyRequest): UserRole[] {
  const raw = request.headers["x-user-roles"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((role) => role.trim())
    .filter((role): role is UserRole => VALID_ROLES.has(role));
}
