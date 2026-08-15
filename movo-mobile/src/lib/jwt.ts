/**
 * Decodifica el claim `exp` de un JWT sin verificar la firma — el token ya salió del
 * backend (o de secure-store, donde lo dejó un login/register anterior), esto es solo
 * para estimar cuánto le queda de vida en el cliente. Nunca se usa como fuente de
 * verdad de autorización (eso lo valida el backend en cada request).
 */
export function getJwtExpiresInSeconds(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: unknown };
    if (typeof payload.exp !== "number") return null;
    return Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
  } catch {
    return null;
  }
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}
