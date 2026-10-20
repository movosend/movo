import { ApiError } from "@movo/shared/src/errors/api-error"
import { publicError } from "@/lib/auth/api"
import type { ActionResult } from "./action-result"

const BY_CODE: Record<string, string> = {
  CONTACT_CHANGED:
    "El dato cambió mientras lo editabas. Cerrá el diálogo y abrilo de nuevo para ver el valor actual.",
  CONTACT_UNCHANGED: "El valor nuevo es igual al actual.",
  EMAIL_ALREADY_IN_USE: "Ese email ya pertenece a otra cuenta.",
  PHONE_ALREADY_IN_USE: "Ese teléfono ya pertenece a otra cuenta.",
  USER_DELETED: "La cuenta está eliminada: no admite esta acción.",
  USER_NOT_FOUND: "La cuenta ya no existe.",
  AMOUNT_OUT_OF_RANGE:
    "El monto es cero o supera el máximo permitido para un ajuste.",
  LEDGER_IDEMPOTENCY_CONFLICT:
    "Ya se envió un ajuste distinto con esta misma operación. Cerrá el diálogo y empezá de nuevo.",
  VALIDATION_FAILED: "Revisá los datos: alguno no es válido.",
}

/**
 * Error de una acción de soporte a texto para el diálogo. Un 5xx o un servicio dueño caído no dice
 * si la acción llegó a aplicarse (la bitácora queda como "Sin confirmar"): se avisa y no se reintenta
 * a ciegas.
 */
export function actionFailure(error: unknown): ActionResult<never> {
  if (!(error instanceof ApiError))
    return { ok: false, error: publicError(error) }
  const unconfirmed = error.statusCode >= 500
  if (unconfirmed)
    return {
      ok: false,
      error:
        "El servicio no respondió. Puede que la acción se haya aplicado: revisá la bitácora antes de volver a intentar.",
      code: error.code,
      status: error.statusCode,
      unconfirmed: true,
    }
  return {
    ok: false,
    error: BY_CODE[error.code] ?? publicError(error),
    code: error.code,
    status: error.statusCode,
  }
}
