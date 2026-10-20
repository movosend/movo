export const ACCESS_COOKIE = "__Host-movo-access"
export const REFRESH_COOKIE = "__Host-movo-refresh"
export const CHALLENGE_COOKIE = "__Host-movo-challenge"
export const RESET_COOKIE = "__Host-movo-reset"
export const GRANT_COOKIE = "__Host-movo-grant"
export const PASSWORD_CHANGED = "Cambiaste tu contraseña. Ingresá con la nueva."
export const SESSION_EXPIRED = "Tu sesión venció. Volvé a iniciar sesión"
// /users (con búsqueda y página) y la ficha /users/<uuid>. Sin barras dobles ni esquemas.
const USERS_PATH =
  /^\/users(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?(\?[A-Za-z0-9=&%+._~-]*)?$/i

export function internalReturnPath(value: string | null): string {
  // Only implemented protected destinations are accepted. Never redirect to auth.
  if (value === "/" || value === "/admins") return value
  return value !== null && USERS_PATH.test(value) ? value : "/"
}
