import { FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El `userId` sale del header `x-user-id`, inyectado por el gateway después de
 * validar el JWT (ADR-010). Un valor ausente o mal formado acá significa que la
 * request no pasó por el gateway como se esperaba (o alguien está pegándole directo
 * al servicio) — no es el caso de "usuario no encontrado" (eso lo resuelve el
 * service con 404). Compartido entre `kyc.routes.ts` y `users.routes.ts` (review de
 * PR #55, tmvergara) para que MOVO-31 lo reuse sin una tercera copia.
 */
export function requireUserIdFromHeader(request: FastifyRequest): string {
  const raw = request.headers["x-user-id"];
  const userId = Array.isArray(raw) ? raw[0] : raw;
  if (!userId || !UUID_PATTERN.test(userId)) {
    throw new ApiError(401, "AUTH_TOKEN_INVALID", "Falta autenticación válida para esta operación.");
  }
  return userId;
}
