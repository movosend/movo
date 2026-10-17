export const ACCESS_COOKIE = "__Host-movo-access"
export const REFRESH_COOKIE = "__Host-movo-refresh"
export const CHALLENGE_COOKIE = "__Host-movo-challenge"
export const SESSION_EXPIRED = "Tu sesión venció. Volvé a iniciar sesión"
export function internalReturnPath(value: string | null): string {
  // Only implemented protected destinations are accepted. Never redirect to auth.
  return value === "/" || value === "/admins" ? value : "/"
}
