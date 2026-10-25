import type { ShipmentStatusValue } from "./format"

/**
 * Resultado de una acción del cambio de estado (MOVO-333). El error viaja como dato para mostrarlo dentro del
 * modal sin perder lo que el admin escribió.
 */
export type StatusFailure = {
  ok: false
  /** Texto listo para mostrar. */
  error: string
  /** Código del backend (`STATUS_CHANGED`, `HOLD_NOT_AUTHORIZED`...), para que el modal reaccione distinto. */
  code?: string
  status?: number
  /** Si el servicio no respondió, el cambio pudo haberse aplicado igual: hay que mirar la línea de tiempo. */
  unconfirmed?: boolean
  /** En `STATUS_CHANGED`: el estado en el que está el envío ahora. */
  currentStatus?: ShipmentStatusValue
  /**
   * Token del segundo factor ya verificado, si el rechazo no lo gastó: el modal lo conserva para reintentar sin
   * pedir otro código. Dura 5 minutos y sirve para una sola acción (envío + destino).
   */
  stepUpToken?: string
}

export type StatusResult<T> = { ok: true; data: T } | StatusFailure
