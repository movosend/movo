import { ApiError } from "@movo/shared/src/errors/api-error"
import { publicError } from "@/lib/auth/api"
import { formatArs } from "@/lib/users/format"

/** Resultado de una acción sobre una disputa: el error viaja como dato para mostrarlo dentro del diálogo. */
export type DisputeResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: string
      code?: string
      status?: number
      /** 422 `DISPUTE_PARTIAL_BELOW_MINIMUM`: lo mínimo que tiene que conservar el transportista. */
      minimumArs?: number
      /** 422 `DISPUTE_PARTIAL_ABOVE_MAXIMUM`: lo máximo en juego. */
      maximumArs?: number
      /** La acción de pago falló: la disputa quedó en "Procesando pago" y se reintenta con los mismos datos. */
      paymentFailed?: boolean
      /** El servicio no respondió: la acción pudo aplicarse igual. */
      unconfirmed?: boolean
    }

const BY_CODE: Record<string, string> = {
  DISPUTE_NOT_FOUND: "La disputa ya no existe. Volvé a la bandeja.",
  DISPUTE_NOT_OPEN:
    "La disputa ya no está abierta. Actualizá el expediente para ver cómo quedó.",
  DISPUTE_RESOLUTION_MISMATCH:
    "La disputa ya tiene guardado otro resultado. Para reintentar, usá los mismos datos con los que se resolvió.",
  DISPUTE_RESOLUTION_IN_PROGRESS:
    "Otra resolución de esta disputa está en curso. Esperá un momento y actualizá el expediente.",
  DISPUTE_PARTIAL_INVALID:
    "Un resultado parcial lleva un porcentaje o un monto, no ambos ni ninguno.",
  VALIDATION_FAILED: "Revisá los datos: alguno no es válido.",
}

/** Error de una acción de disputa a texto para el diálogo. */
export function disputeFailure(error: unknown): DisputeResult<never> {
  if (!(error instanceof ApiError))
    return { ok: false, error: publicError(error) }
  if (error.code === "DISPUTE_PAYMENT_FAILED")
    return {
      ok: false,
      code: error.code,
      status: error.statusCode,
      paymentFailed: true,
      error:
        "No se pudo confirmar el movimiento de plata. La resolución quedó guardada y la disputa en «Procesando pago»: reintentá con los mismos datos.",
    }
  if (error.code === "DISPUTE_PARTIAL_BELOW_MINIMUM") {
    const minimumArs = Number(error.details?.minimumArs)
    return {
      ok: false,
      code: error.code,
      status: error.statusCode,
      ...(Number.isFinite(minimumArs) && { minimumArs }),
      error: Number.isFinite(minimumArs)
        ? `Con ese monto la captura no cubre la comisión de la reserva más la de Mercado Pago. El mínimo es ${formatArs(minimumArs)}.`
        : "Con ese monto la captura no cubre las comisiones.",
    }
  }
  if (error.code === "DISPUTE_PARTIAL_ABOVE_MAXIMUM") {
    const maximumArs = Number(error.details?.maximumArs)
    return {
      ok: false,
      code: error.code,
      status: error.statusCode,
      ...(Number.isFinite(maximumArs) && { maximumArs }),
      error:
        "El monto no puede ser igual ni mayor al total en juego: elegí «A favor del transportista».",
    }
  }
  // Otro 5xx no dice si llegó a aplicarse: se avisa y no se reintenta a ciegas.
  if (error.statusCode >= 500)
    return {
      ok: false,
      code: error.code,
      status: error.statusCode,
      unconfirmed: true,
      error:
        "El servicio no respondió. Puede que la acción se haya aplicado: actualizá el expediente antes de volver a intentar.",
    }
  return {
    ok: false,
    code: error.code,
    status: error.statusCode,
    error: BY_CODE[error.code] ?? publicError(error),
  }
}
