import { ApiError, PublicProfile } from "@movo/shared";

/**
 * Cliente HTTP síncrono hacia `movo-svc-users` — primera llamada interna
 * servicio-a-servicio del repo (el resto de los adapters de MOVO hablan con APIs de
 * terceros: Didit, Twilio, Google Maps, S3). Comunicación REST síncrona sin message
 * broker, conforme a ADR-001/ADR-005.
 */
export interface DeviceKey {
  publicKey: string;
  registeredAt: string;
}

export interface UsersClient {
  /**
   * Devuelve la proyección pública del usuario, o `null` si no existe (404 de
   * svc-users) — nunca lanza por "no encontrado", esa es una decisión de negocio del
   * caller (shipments.service.ts), no un fallo de transporte.
   */
  findPublicProfile(userId: string, callerUserId: string): Promise<PublicProfile | null>;
  /**
   * MOVO-158: clave pública vigente del dispositivo de `userId` (MOVO-157), para
   * verificar la firma del cedente de un handshake. `null` si el usuario no tiene
   * clave registrada (404 `DEVICE_KEY_NOT_FOUND` de svc-users) — igual que
   * `findPublicProfile`, "no tiene clave todavía" es un resultado de negocio válido,
   * no un fallo de transporte.
   */
  findDeviceKey(userId: string): Promise<DeviceKey | null>;
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

    async findDeviceKey(userId: string): Promise<DeviceKey | null> {
      let response: Response;
      try {
        // `/internal/users/:id/device-key` (MOVO-157) no pasa por el gateway --
        // perimetral, mismo criterio que `/internal/notifications` -- así que a
        // diferencia de findPublicProfile no manda `x-user-id`: el caller acá es
        // otro servicio, no un usuario autenticado.
        response = await fetch(`${config.USERS_SERVICE_URL}/internal/users/${encodeURIComponent(userId)}/device-key`, {
          method: "GET",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "No se pudo conectar con el servicio de usuarios.");
      }

      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "El servicio de usuarios devolvió un error.");
      }

      return (await response.json()) as DeviceKey;
    },
  };
}
