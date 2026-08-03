/**
 * `EXPO_PUBLIC_*` env vars quedan embebidas en el bundle en build time (no son
 * secretas — por eso el prefijo `EXPO_PUBLIC_`). Se resuelven por ambiente vía
 * `.env.local` (local, gitignored) o los perfiles de `eas.json` (dev/prod).
 * Ver `.env.example`.
 */
export function getApiBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (!url) {
    throw new Error(
      "EXPO_PUBLIC_API_URL no está definida. Copiá .env.example a .env.local " +
        "y completá la URL del gateway (ver movo-mobile/.env.example).",
    );
  }
  return url.replace(/\/+$/, "");
}
