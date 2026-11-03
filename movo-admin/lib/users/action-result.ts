import type { InProgressShipment } from "@movo/shared/src/types/admin"

/** Resultado de una acción de soporte: el error viaja como dato para mostrarlo dentro del diálogo. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: string
      /** Código del backend (`CONTACT_CHANGED`…), para que el diálogo reaccione distinto. */
      code?: string
      status?: number
      /** Si el servicio dueño no respondió, la acción pudo haberse aplicado igual. */
      unconfirmed?: boolean
      /** MOVO-299: lo que impide inhabilitar (`USER_HAS_IN_PROGRESS_SHIPMENTS`). */
      inProgressShipments?: InProgressShipment[]
    }
