import { createExpoPushProvider } from "./expo-push-provider";
import { createMockPushProvider, MockPushProvider } from "./mock-push-provider";

/**
 * Interfaz genérica de envío de push notifications (MOVO-106, primera implementación
 * de push en el proyecto) — mismo patrón que `SmsProvider`/`DiditClient`/
 * `GeocodingProvider`/`StorageProvider`: interfaz + real + mock, mock como default de
 * dev/test/CI. No vive en `@movo/shared` por el mismo motivo que esos otros adapters:
 * es un detalle de infraestructura de `svc-users`, no un contrato de dominio.
 */
export interface PushNotificationProvider {
  /** Lanza `ApiError` si el envío falla (red, HTTP no-2xx, o el proveedor reporta el
   * envío como fallido) -- el caller (AC6: `notifications.service.ts`) decide si un
   * fallo individual aborta el resto o no. */
  send(input: { expoPushToken: string; title: string; body: string; data?: Record<string, unknown> }): Promise<void>;
}

export interface PushNotificationProviderConfig {
  PUSH_PROVIDER: "mock" | "expo";
}

/**
 * Selecciona la implementación según `PUSH_PROVIDER` (default "mock", mismo criterio
 * que `SMS_PROVIDER=console`/`DIDIT_MODE=mock`/`GEOCODING_PROVIDER=mock`/
 * `STORAGE_PROVIDER=mock`): no depender de red para levantar el servicio en
 * dev/test/CI. A diferencia de esos otros proveedores, la API pública de Expo Push no
 * requiere credenciales -- no hay nada que validar al arrancar con `PUSH_PROVIDER=expo`.
 */
export function createPushNotificationProvider(config: PushNotificationProviderConfig): PushNotificationProvider {
  if (config.PUSH_PROVIDER === "expo") {
    return createExpoPushProvider();
  }
  return createMockPushProvider();
}

export type { MockPushProvider };
