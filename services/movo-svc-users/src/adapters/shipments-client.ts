import { ApiError } from "@movo/shared";

/**
 * Cliente HTTP síncrono hacia `movo-svc-shipments` — primera llamada interna en este
 * sentido (hasta ahora la única llamada servicio-a-servicio del proyecto era la
 * inversa, `svc-shipments` → `svc-users`, ver `users-client.ts` de MOVO-80). Pega
 * contra el endpoint interno `/internal/account-deletion/*` (MOVO-134), no proxeado
 * por el gateway.
 */
export interface ShipmentsClient {
  /**
   * ¿El usuario (como sender, receiver o carrier) tiene algún envío en un estado no
   * terminal? Usado por `DELETE /users/me` antes de aplicar la baja de cuenta -- nunca
   * lanza por "tiene envíos activos", esa es una decisión de negocio del caller
   * (`users.service.ts#deleteAccount`), no un fallo de transporte.
   */
  hasActiveShipments(userId: string): Promise<{ hasActiveDispute: boolean; hasActiveShipments: boolean }>;
}

export interface ShipmentsClientConfig {
  SHIPMENTS_SERVICE_URL: string;
}

// Mismo criterio que users-client.ts (MOVO-80): sin timeout explícito, una demora en
// svc-shipments cuelga indefinidamente la baja de cuenta.
const REQUEST_TIMEOUT_MS = 5000;

export function createShipmentsClient(config: ShipmentsClientConfig): ShipmentsClient {
  return {
    async hasActiveShipments(userId: string): Promise<{ hasActiveDispute: boolean; hasActiveShipments: boolean }> {
      let response: Response;
      try {
        response = await fetch(
          `${config.SHIPMENTS_SERVICE_URL}/internal/account-deletion/users/${encodeURIComponent(userId)}/active-shipments`,
          {
            method: "GET",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }
        );
      } catch {
        // Cubre red caída y timeout por igual -- en ambos casos el resultado para el
        // caller es el mismo: no se pudo confirmar que la cuenta esté libre de envíos
        // activos, así que la baja no se aplica (sin alternativa segura a "permitir
        // siempre" acá, a diferencia de MOVO-80 con la validación de receptor).
        throw new ApiError(502, "SHIPMENTS_SERVICE_UNAVAILABLE", "No se pudo conectar con el servicio de envíos.");
      }

      if (!response.ok) {
        throw new ApiError(502, "SHIPMENTS_SERVICE_UNAVAILABLE", "El servicio de envíos devolvió un error.");
      }

      return (await response.json()) as { hasActiveDispute: boolean; hasActiveShipments: boolean };
    },
  };
}
