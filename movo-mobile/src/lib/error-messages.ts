import { ApiError, type ApiErrorCode } from "@movo/shared/dist/errors/api-error";

/**
 * Traduce códigos de error estables de la API a mensajes en español,
 * amigables para el usuario final. El `message` que manda el backend es para
 * logs/debug, no para mostrar tal cual en la UI (puede ser técnico o estar en
 * inglés). Central para toda la app — si se agrega un `ApiErrorCode` nuevo al
 * contrato, sumar acá su traducción.
 */
const CODE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  AUTH_INVALID_CREDENTIALS: "El teléfono o la contraseña no son correctos.",
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
  KYC_PROVIDER_ERROR: "Hubo un problema con el servicio de verificación. Intentá de nuevo más tarde.",
  STORAGE_PROVIDER_ERROR: "Hubo un problema con el almacenamiento de la imagen. Intentá de nuevo.",
  PHOTO_OBJECT_NOT_FOUND: "No pudimos procesar la imagen subida. Intentá cargarla de nuevo.",
  PHOTO_FORBIDDEN_KEY: "No tenés permiso para guardar esta foto.",
  USER_NOT_FOUND: "No se encontró el usuario.",
  USER_EMAIL_ALREADY_EXISTS: "El email ya se encuentra registrado.",
  USER_PHONE_ALREADY_EXISTS: "El teléfono ya se encuentra registrado.",
  SHIPMENT_RECEIVER_IS_SENDER: "No podés elegirte a vos mismo como receptor.",
  SHIPMENT_RECEIVER_KYC_NOT_APPROVED: "El receptor todavía no tiene su identidad verificada.",
  SHIPMENT_PICKUP_WINDOW_IN_PAST: "Elegí una fecha y horario de retiro que todavía no haya pasado.",
  SHIPMENT_PICKUP_WINDOW_INVALID: "El horario de fin del retiro tiene que ser posterior al de inicio.",
  SHIPMENT_PICKUP_DELIVERY_TOO_CLOSE: "El retiro y la entrega tienen que estar en ubicaciones distintas.",
  GEOCODING_PROVIDER_ERROR: "No pudimos validar la dirección en el mapa. Intentá de nuevo.",
  GEOCODING_ADDRESS_NOT_FOUND: "No encontramos la dirección ingresada.",
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
 *
 * `overrides` (MOVO-136) permite que una pantalla puntual reescriba el mensaje de un
 * código cuyo texto global está redactado para otro contexto. El caso que lo motivó:
 * `AUTH_INVALID_CREDENTIALS` dice "El teléfono o la contraseña no son correctos"
 * porque nació para el login, pero en "Cuenta y seguridad" no hay ningún teléfono en
 * juego — ahí significa "la contraseña actual no es correcta". Es un override, no un
 * cambio del mapa global: el mensaje del login sigue siendo el correcto para el login.
 */
export function friendlyErrorMessage(
  err: unknown,
  fallback: string,
  overrides?: Partial<Record<ApiErrorCode, string>>,
): string {
  if (!(err instanceof ApiError)) return fallback;
  if (err.statusCode === 0) return err.message;
  return overrides?.[err.code] ?? CODE_MESSAGES[err.code] ?? fallback;
}
