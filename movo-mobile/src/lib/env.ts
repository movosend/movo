import { getApiOverride } from "./api-override";

/**
 * `EXPO_PUBLIC_*` env vars quedan embebidas en el bundle en build time (no son
 * secretas — por eso el prefijo `EXPO_PUBLIC_`). Se resuelven por ambiente vía
 * `.env.local` (local, gitignored) o los perfiles de `eas.json` (dev/prod).
 * Ver `.env.example`.
 *
 * En builds de desarrollo (`__DEV__`), un override seteado desde la vista dev
 * (`app/dev-connection.tsx`, ver `src/lib/api-override.ts`) tiene prioridad
 * sobre `EXPO_PUBLIC_API_URL` — permite apuntar a un backend local (IP LAN)
 * sin reconstruir el bundle. Se ignora explícitamente en producción: no hay
 * forma de que un build de store termine pegándole a una URL arbitraria.
 */
export function getApiBaseUrl(): string {
  if (__DEV__) {
    const override = getApiOverride();
    if (override) {
      return override;
    }
  }

  const url = process.env.EXPO_PUBLIC_API_URL;
  if (!url) {
    throw new Error(
      "EXPO_PUBLIC_API_URL no está definida. Copiá .env.example a .env.local " +
        "y completá la URL del gateway (ver movo-mobile/.env.example).",
    );
  }
  return url.replace(/\/+$/, "");
}
