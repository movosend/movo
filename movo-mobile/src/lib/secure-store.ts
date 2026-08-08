import * as SecureStore from "expo-secure-store";

/**
 * Wrapper base sobre `expo-secure-store`. Genérico a propósito — quien define qué
 * significa cada key es el caller, no este módulo.
 *
 * Dos familias de keys conviven acá, a propósito separadas: `pendingRegistration*`
 * (token efímero del wizard de onboarding pre-cuenta, MOVO-73) y `session*` (sesión
 * autenticada post-login/registro, MOVO-76). No se unificaron porque tienen ciclos de
 * vida distintos — el de onboarding vive lo que dura el wizard y se descarta al
 * terminar, el de sesión persiste entre aperturas de la app y sobrevive el refresh
 * automático — mezclarlos acoplaría dos conceptos que ya están separados en el resto
 * del código (`use-registration.tsx` vs. `src/store/auth-store.ts`).
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
   * hay registro pendiente" — decisión aceptada en `use-registration.tsx`: es un token
   * efímero de un flujo que todavía no terminó, no la sesión autenticada del usuario
   * (esa sí tiene refresh automático, ver `session*` abajo), así que no vale la pena
   * traer esa complejidad a un flujo que de todos modos termina resolviéndose contra
   * el backend en cada paso. */
  pendingRegistrationAccessToken: "movo.pendingRegistrationAccessToken",
  pendingRegistrationRefreshToken: "movo.pendingRegistrationRefreshToken",
  /** Sesión autenticada (MOVO-76) — fuente de verdad que `src/store/auth-store.ts`
   * lee al bootear la app (`restoreSession`) y escribe en cada login/refresh/logout.
   * `sessionExpiresAt` es un epoch ms (`issuedAt + expiresIn*1000`) usado para decidir
   * si hace falta un refresh proactivo antes de mostrar ninguna pantalla (AC7). */
  sessionAccessToken: "movo.session.accessToken",
  sessionRefreshToken: "movo.session.refreshToken",
  sessionUser: "movo.session.user",
  sessionExpiresAt: "movo.session.expiresAt",
  /** Override de `EXPO_PUBLIC_API_URL` seteado desde la vista dev — ver `src/lib/api-override.ts`. */
  apiBaseUrlOverride: "movo.dev.apiBaseUrlOverride",
} as const;
