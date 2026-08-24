import { FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El gateway inyecta `x-user-id` (JWT `sub`) en todo request protegido, tras validar
 * el JWT y limpiar cualquier header `x-user-*` que haya mandado el cliente (ADR-010,
 * MOVO-68). Este servicio confía en el header sin revalidar el JWT — mismo patrón que
 * `movo-svc-users/src/utils/require-user-id.ts`, copiado acá (convención del repo: cada
 * servicio mantiene su propia copia, no se extrae a `@movo/shared`).
 */
export function requireUserIdFromHeader(request: FastifyRequest): string {
  const raw = request.headers["x-user-id"];
  const userId = Array.isArray(raw) ? raw[0] : raw;
  if (!userId || !UUID_PATTERN.test(userId)) {
    throw new ApiError(401, "AUTH_TOKEN_INVALID", "Falta autenticación válida para esta operación.");
  }
  return userId;
}
