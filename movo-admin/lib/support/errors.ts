import { ApiError } from "@movo/shared/src/errors/api-error"
import { SUPPORT_ERROR } from "@movo/shared/src/types/admin-support"
import { publicError } from "@/lib/auth/api"

const BY_CODE: Record<string, string> = {
  [SUPPORT_ERROR.CONFLICT]:
    "Esta consulta es tuya: no podés responderla ni modificarla. Pedile a otra persona del equipo que la atienda.",
  [SUPPORT_ERROR.NOT_FOUND]: "La consulta ya no existe.",
  [SUPPORT_ERROR.ATTACHMENT_INVALID]:
    "Alguna imagen no es válida: solo JPG, PNG o WebP de hasta 5 MB, y hasta 4 por mensaje.",
  [SUPPORT_ERROR.SHIPMENT_NOT_PARTY]:
    "Ese usuario no es parte del envío elegido.",
  [SUPPORT_ERROR.TICKET_INVALID]: "No pudimos abrir la conexión en vivo.",
  VALIDATION_FAILED: "Revisá los datos: alguno no es válido.",
}

export interface SupportFailure {
  ok: false
  error: string
  code?: string
  status?: number
  /** Un 5xx puede haber aplicado la escritura: no se reintenta a ciegas. */
  unconfirmed?: boolean
}

export type SupportResult<T> = { ok: true; data: T } | SupportFailure

/** Error de una acción de soporte a texto para el panel. */
export function supportFailure(error: unknown): SupportFailure {
  if (!(error instanceof ApiError))
    return { ok: false, error: publicError(error) }
  if (error.statusCode >= 500)
    return {
      ok: false,
      error:
        "El servicio no respondió. Puede que se haya aplicado: revisá la conversación antes de reintentar.",
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
