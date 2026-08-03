import * as SecureStore from "expo-secure-store";

/**
 * Wrapper base sobre `expo-secure-store`. Genérico a propósito — no conoce
 * tokens ni sesiones todavía (eso lo agrega MOVO-76, que guarda
 * access/refresh tokens acá). En esta US se usa únicamente para persistir el
 * `userId` del registro en curso, necesario para el flujo reanudable (ver
 * AC7 de MOVO-73): el paso de onboarding en el que está el usuario se deriva
 * consultando al backend con ese `userId`, nunca de estado local.
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
} as const;
