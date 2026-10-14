import { ApiError } from "@movo/shared";

/**
 * MOVO-100: `svc-payments` no conoce a los usuarios (ADR-003/019); el email que lleva el
 * customer de MP se lo pide a `svc-users`, que es su dueño. Versión mínima del cliente de
 * `svc-shipments` (`findAccountEmail`): solo lo que se usa acá.
 */
export interface UsersClient {
  /**
   * Email de la cuenta de `userId` (`GET /users/me` con su propio `x-user-id`, ADR-010).
   * `null` si la cuenta no existe; lanza 502 ante cualquier otra falla (falla cerrado).
   */
  findAccountEmail(userId: string): Promise<string | null>;
}

const REQUEST_TIMEOUT_MS = 5000;

export function createUsersClient(config: { USERS_SERVICE_URL: string }): UsersClient {
  return {
    async findAccountEmail(userId) {
      let response: Response;
      try {
        response = await fetch(`${config.USERS_SERVICE_URL}/users/me`, {
          method: "GET",
          headers: { "x-user-id": userId },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "No se pudo conectar con el servicio de usuarios.");
      }
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "El servicio de usuarios devolvió un error.");
      }
      const body = (await response.json()) as { email?: unknown };
      return typeof body.email === "string" && body.email.length > 0 ? body.email : null;
    },
  };
}
