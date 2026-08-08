import { ApiError, type ApiErrorCode } from "@movo/shared/dist/errors/api-error";

/**
 * Traduce códigos de error estables de la API a mensajes en español,
 * amigables para el usuario final. El `message` que manda el backend es para
 * logs/debug, no para mostrar tal cual en la UI (puede ser técnico o estar en
 * inglés). Central para toda la app — si se agrega un `ApiErrorCode` nuevo al
 * contrato, sumar acá su traducción.
 */
const CODE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  AUTH_INVALID_CREDENTIALS: "El email o la contraseña no son correctos.",
  AUTH_TOKEN_EXPIRED: "Tu sesión expiró. Iniciá sesión de nuevo.",
  AUTH_TOKEN_INVALID: "Tu sesión no es válida. Iniciá sesión de nuevo.",
  AUTH_FORBIDDEN: "No tenés permiso para hacer esto.",
  AUTH_OTP_INVALID: "El código ingresado no es correcto. Revisalo e intentá de nuevo.",
  AUTH_OTP_EXPIRED: "El código venció. Pedí uno nuevo.",
  ACCOUNT_SUSPENDED: "Tu cuenta está suspendida. Contactá a soporte para más información.",
  // El backend permite pedir una sesión de KYC desde cualquier estado salvo `approved`
  // (ver ALLOWED_SESSION_SOURCE_STATUSES en svc-users), así que el único caso real que
  // llega acá es una identidad ya verificada — un "intentá de nuevo" sería engañoso.
  KYC_SESSION_NOT_ALLOWED: "Tu identidad ya está verificada.",
  VALIDATION_FAILED: "Revisá los datos ingresados, hay algo que no es válido.",
  NOT_FOUND: "No encontramos lo que buscábamos.",
  RATE_LIMIT_EXCEEDED: "Hiciste demasiados intentos. Esperá un momento y volvé a intentar.",
  INTERNAL_ERROR: "Ocurrió un error inesperado. Intentá de nuevo en unos minutos.",
};

/**
 * Mensaje user-friendly a partir de un error de API, con fallback específico
 * de la acción que falló. Las fallas de red (`statusCode === 0`) ya traen un
 * mensaje armado por `http-client.ts` ("No se pudo conectar…") — se muestra
 * tal cual porque es el caso donde más importa ser preciso (vs. genérico) y
 * ya está en español.
 */
export function friendlyErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  if (err.statusCode === 0) return err.message;
  return CODE_MESSAGES[err.code] ?? fallback;
}
