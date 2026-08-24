import { secureStore, SECURE_STORE_KEYS } from "./secure-store";

/**
 * Override de `EXPO_PUBLIC_API_URL`, seteable desde la vista dev
 * (`app/dev-connection.tsx`) para apuntar a un backend local durante
 * desarrollo sin tener que reconstruir el bundle. Solo tiene efecto en
 * builds de desarrollo (`__DEV__`) — `env.ts` ignora el override en
 * producción, así que no hace falta gatear cada call site.
 *
 * `getApiOverride()` es síncrono porque `http-client.ts` arma la URL de cada
 * request de forma síncrona (`buildUrl`) — por eso el valor se cachea acá en
 * memoria en vez de leerlo de `expo-secure-store` (async) en cada request.
 * `loadApiOverride()` hidrata esa caché una vez al boot, desde `app/_layout.tsx`.
 */
let cachedOverride: string | null = null;

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function loadApiOverride(): Promise<void> {
  const stored = await secureStore.getItem(SECURE_STORE_KEYS.apiBaseUrlOverride);
  cachedOverride = stored && stored.length > 0 ? stored : null;
}

export function getApiOverride(): string | null {
  return cachedOverride;
}

export async function setApiOverride(url: string | null): Promise<void> {
  if (!url || url.trim().length === 0) {
    cachedOverride = null;
    await secureStore.deleteItem(SECURE_STORE_KEYS.apiBaseUrlOverride);
    return;
  }
  const normalized = normalize(url);
  cachedOverride = normalized;
  await secureStore.setItem(SECURE_STORE_KEYS.apiBaseUrlOverride, normalized);
}
