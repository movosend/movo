import * as SecureStore from "expo-secure-store";

/**
 * Wrapper base sobre `expo-secure-store`. Genérico a propósito — la lógica de sesión
 * completa (interceptor de `Authorization`, refresh automático en 401) sigue siendo
 * alcance de MOVO-76. Esta US ya persiste acá el `accessToken`/`refreshToken` que
 * devuelve `register()` (PR #51 de MOVO-72 lo cambió para que autentique igual que
 * `login()`) — sin esto, ni el paso de mapa ni las llamadas a `/kyc/session`/
 * `/kyc/status` tienen de dónde sacar el token para el header `Authorization` que
 * ahora exigen. También el `userId` del registro en curso, necesario para el flujo
 * reanudable (AC7 de MOVO-73): el paso de onboarding en el que está el usuario se
 * deriva consultando al backend, nunca de estado local.
 */
export const secureStore = {
  getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  },
  setItem(key: string, value: string): Promise<void> {
    return SecureStore.setItemAsync(key, value);
  },
  deleteItem(key: string): Promise<void> {
    return SecureStore.deleteItemAsync(key);
  },
};

export const SECURE_STORE_KEYS = {
  /** `userId` del registro en curso — usado para reanudar el onboarding, no para auth. */
  pendingRegistrationUserId: "movo.pendingRegistrationUserId",
  /** Tokens emitidos por `register()` — necesarios para el header `Authorization` de
   * `/kyc/session`/`/kyc/status` (protegidas desde PR #51 de MOVO-72) y para retomar
   * el onboarding si el usuario cierra la app antes de terminar el KYC (AC7). Si el
   * access token venció mientras la app estaba cerrada, el resume se trata como "no
   * hay registro pendiente" — no hay refresh automático todavía (MOVO-76, limitación
   * aceptada de este sprint, ver use-registration.tsx). */
  pendingRegistrationAccessToken: "movo.pendingRegistrationAccessToken",
  pendingRegistrationRefreshToken: "movo.pendingRegistrationRefreshToken",
  /** Override de `EXPO_PUBLIC_API_URL` seteado desde la vista dev — ver `src/lib/api-override.ts`. */
  apiBaseUrlOverride: "movo.dev.apiBaseUrlOverride",
} as const;
