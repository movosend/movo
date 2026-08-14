import { httpClient } from "./http-client";

/**
 * Cliente contra `POST`/`DELETE /users/me/push-token` (MOVO-107, contrato definido en
 * MOVO-106 — `services/movo-svc-users`, todavía sin implementar al momento de escribir
 * esto). Ambas rutas protegidas — `httpClient` adjunta `Authorization` automáticamente
 * vía el interceptor de sesión (MOVO-76), mismo criterio que `usersClient`.
 */

export type PushPlatform = "ios" | "android";

export interface RegisterPushTokenPayload {
  expoPushToken: string;
  deviceId: string;
  platform: PushPlatform;
}

export const notificationsClient = {
  registerPushToken(payload: RegisterPushTokenPayload): Promise<void> {
    return httpClient.post<void>("/users/me/push-token", payload);
  },
  unregisterPushToken(deviceId: string): Promise<void> {
    return httpClient.delete<void>("/users/me/push-token", { deviceId });
  },
};
