import { ApiError, PublicProfile } from "@movo/shared";

/**
 * Cliente HTTP síncrono hacia `movo-svc-users` — primera llamada interna
 * servicio-a-servicio del repo (el resto de los adapters de MOVO hablan con APIs de
 * terceros: Didit, Twilio, Google Maps, S3). Comunicación REST síncrona sin message
 * broker, conforme a ADR-001/ADR-005.
 */
export interface UsersClient {
  /**
   * Devuelve la proyección pública del usuario, o `null` si no existe (404 de
   * svc-users) — nunca lanza por "no encontrado", esa es una decisión de negocio del
   * caller (shipments.service.ts), no un fallo de transporte.
   */
  findPublicProfile(userId: string, callerUserId: string): Promise<PublicProfile | null>;
}

export interface UsersClientConfig {
  USERS_SERVICE_URL: string;
}

// Sin timeout explícito, una demora en svc-users cuelga indefinidamente el request de
// creación de envío — el modo de falla clásico de los microservicios síncronos
// (ver guía de MOVO-80 en Linear). AbortSignal.timeout es nativo (Node 20+), primer
// uso de este patrón en el repo.
const REQUEST_TIMEOUT_MS = 5000;

export function createUsersClient(config: UsersClientConfig): UsersClient {
  return {
    async findPublicProfile(userId: string, callerUserId: string): Promise<PublicProfile | null> {
      let response: Response;
      try {
        // svc-users exige `x-user-id` válido también en llamadas internas (ADR-010) —
        // se manda el del caller autenticado (el senderId real de la creación del
        // envío), no un valor sintético.
        response = await fetch(`${config.USERS_SERVICE_URL}/users/${encodeURIComponent(userId)}`, {
          method: "GET",
          headers: { "x-user-id": callerUserId },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // Cubre tanto la red caída como el abort del timeout — en ambos casos el
        // resultado para el caller es el mismo: "no pudimos confirmar al receptor".
        throw new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "No se pudo conectar con el servicio de usuarios.");
      }

      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "El servicio de usuarios devolvió un error.");
      }

      return (await response.json()) as PublicProfile;
    },
  };
}
