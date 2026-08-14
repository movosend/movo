import * as Crypto from "expo-crypto";
import { secureStore, SECURE_STORE_KEYS } from "./secure-store";

/**
 * `deviceId` estable para el registro de push token (MOVO-107) — generado una sola vez
 * por instalación con `Crypto.randomUUID()` (`expo-crypto`, no el paquete `uuid`: evita
 * el polyfill de `crypto.getRandomValues` que ese paquete necesita en RN/Hermes) y
 * persistido en `expo-secure-store`. Llamadas subsiguientes reusan el mismo valor.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await secureStore.getItem(SECURE_STORE_KEYS.pushDeviceId);
  if (existing) {
    return existing;
  }
  const deviceId = Crypto.randomUUID();
  await secureStore.setItem(SECURE_STORE_KEYS.pushDeviceId, deviceId);
  return deviceId;
}
