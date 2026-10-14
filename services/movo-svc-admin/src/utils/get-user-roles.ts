import { FastifyRequest } from "fastify";
import { UserRole } from "@movo/shared";

const VALID_ROLES: ReadonlySet<string> = new Set(Object.values(UserRole));

/**
 * El gateway inyecta `x-user-roles` (comma-joined, ej. "sender,carrier,admin") en todo
 * request protegido (ADR-010). Copia de `movo-svc-shipments/src/utils/get-user-roles.ts`:
 * un header ausente o malformado no lanza, deja al caller sin roles reconocidos.
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
