import { ApiError } from "@movo/shared/src/errors/api-error"
import { publicError } from "@/lib/auth/api"
import { SHIPMENT_STATUS } from "@/lib/users/format"
import type { ShipmentStatusValue } from "./format"
import type { StatusFailure } from "./status-result"

/** Errores de negocio conocidos del cambio de estado, con el texto que se muestra dentro del modal. */
const BY_CODE: Record<string, string> = {
  STATUS_CHANGED:
    "El estado del envío cambió mientras confirmabas. Volvimos a cargar las opciones para que elijas de nuevo.",
  TRANSITION_NOT_ALLOWED: "Esta transición no está permitida.",
  HOLD_NOT_AUTHORIZED:
    "Mercado Pago no tiene el hold autorizado para este envío, así que no se puede dar por asignado. Verificalo antes de reintentar.",
  ADMIN_CONFLICT_OF_INTEREST:
    "Sos parte de este envío (emisor, transportista o receptor), así que no podés cambiarle el estado. Pedile a otro admin que lo haga.",
  STEP_UP_INVALID:
    "El código es inválido, venció o ya se usó. Pedí uno nuevo y volvé a intentar.",
  STEP_UP_REQUIRED:
    "Este cambio pide el código que te mandamos por email. Pedilo y escribilo.",
  TYPED_CODE_MISMATCH: "El código del envío no coincide con el que escribiste.",
  RATE_LIMIT_EXCEEDED:
    "Hiciste demasiados intentos seguidos. Esperá un momento antes de reintentar.",
  FORCE_STATUS_EFFECT_FAILED:
    "Falló un paso del cambio (por ejemplo, liberar el hold) y el envío puede seguir como estaba. Revisá la línea de tiempo y reintentá.",
  FORCE_STATUS_IN_PROGRESS:
    "Hay otro cambio de estado en curso sobre este envío. Esperá unos segundos y reintentá.",
  IDEMPOTENCY_KEY_REUSED:
    "Esta operación ya se había enviado con otros datos. Cerrá el modal y empezá de nuevo.",
  NOT_FOUND: "El envío ya no existe.",
  VALIDATION_FAILED: "Revisá los datos: alguno no es válido.",
}

const isStatus = (value: unknown): value is ShipmentStatusValue =>
  typeof value === "string" && value in SHIPMENT_STATUS

/**
 * Error de una acción del cambio de estado a un resultado para el modal. Un código conocido siempre tiene su texto
 * (aunque venga con 5xx, como `FORCE_STATUS_EFFECT_FAILED`); un 5xx sin código conocido o un servicio caído no dice si
 * el cambio llegó a aplicarse, así que se avisa y no se reintenta a ciegas.
 */
export function statusFailure(
  error: unknown,
  extra: Pick<StatusFailure, "stepUpToken"> = {}
): StatusFailure {
  if (!(error instanceof ApiError))
    return { ok: false, error: publicError(error) }
  const details = error.details
  const known = BY_CODE[error.code]
  if (known) {
    const reason =
      error.code === "TRANSITION_NOT_ALLOWED" &&
      typeof details?.reason === "string"
        ? details.reason
        : known
    return {
      ok: false,
      error: reason,
      code: error.code,
      status: error.statusCode,
      ...(isStatus(details?.currentStatus)
        ? { currentStatus: details.currentStatus }
        : {}),
      ...extra,
    }
  }
  if (error.statusCode >= 500)
    return {
      ok: false,
      error:
        "El servicio no respondió. Puede que el cambio se haya aplicado: mirá la línea de tiempo antes de volver a intentar.",
      code: error.code,
      status: error.statusCode,
      unconfirmed: true,
    }
  return {
    ok: false,
    error: publicError(error),
    code: error.code,
    status: error.statusCode,
    ...extra,
  }
}
