import { ApiError } from "@movo/shared/src/errors/api-error"
import { publicError } from "@/lib/auth/api"
import type { ActionResult } from "@/lib/users/action-result"

const BY_CODE: Record<string, string> = {
  KYC_SESSION_NOT_FOUND: "La verificación ya no existe.",
  KYC_REVIEW_STATUS_CHANGED:
    "Este caso ya no está en revisión: otra persona lo resolvió, Didit ya lo tenía resuelto o la verificación cambió. Volvé a la lista para ver el estado actual.",
  KYC_REVIEW_SUPERSEDED:
    "La persona abrió una verificación más nueva, así que este intento ya no se puede decidir.",
  KYC_REVIEW_IDENTITY_MISSING:
    "No se puede aprobar: Didit no pudo leer el nombre y el apellido del documento, y el nombre de la cuenta sale de ahí. Rechazá la verificación para que la persona la repita.",
  KYC_REVIEW_IN_PROGRESS:
    "Otro admin está decidiendo este caso en este momento. Esperá unos segundos y volvé a la lista para ver cómo quedó.",
  ADMIN_CONFLICT_OF_INTEREST:
    "No podés decidir tu propia verificación. Le tiene que tocar a otro admin.",
  VALIDATION_FAILED: "Revisá el motivo: tiene que tener entre 10 y 500 caracteres.",
  RATE_LIMIT_EXCEEDED: "Demasiados intentos seguidos. Esperá un momento.",
}

/**
 * Error de una decisión de KYC a texto para el diálogo. A diferencia de las demás acciones de soporte, un 502
 * `KYC_PROVIDER_ERROR` es un rechazo seguro (Didit no aceptó el pedido y no se aplicó nada), así que se puede
 * reintentar. Cualquier otro 5xx no dice si se aplicó: la bitácora queda como "Sin confirmar".
 */
export function kycActionFailure(error: unknown): ActionResult<never> {
  if (!(error instanceof ApiError))
    return { ok: false, error: publicError(error) }
  if (error.code === "KYC_PROVIDER_ERROR")
    return {
      ok: false,
      error:
        "Didit no aceptó el pedido, así que no se cambió nada. Probá de nuevo en un momento.",
      code: error.code,
      status: error.statusCode,
    }
  if (error.statusCode >= 500)
    return {
      ok: false,
      error:
        "El servicio no respondió. Puede que la decisión se haya aplicado: actualizá la lista y revisá la bitácora antes de volver a intentar.",
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
