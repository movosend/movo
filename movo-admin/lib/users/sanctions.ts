import type {
  AdminSanctionPreview,
  AdminUserSanction,
} from "@movo/shared/src/types/admin-users"
import type { WithdrawOpenActivityResult } from "@movo/shared/src/types/admin"

/** "1 oferta" / "2 ofertas". */
export const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** Une con comas y una "y" final: "a, b y c". */
function joinEs(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ""
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`
}

/**
 * Lo que va a pasar al sancionar, a partir de la vista previa (AC6): "Se van a cancelar 2
 * publicaciones y retirar 1 oferta. Los 3 envíos en curso siguen."
 */
export function describePreview(preview: AdminSanctionPreview): string[] {
  const retired: string[] = []
  if (preview.shipments > 0)
    retired.push(
      `cancelar ${plural(preview.shipments, "publicación", "publicaciones")}`
    )
  if (preview.offers > 0)
    retired.push(`retirar ${plural(preview.offers, "oferta", "ofertas")}`)
  if (preview.trips > 0)
    retired.push(
      `cancelar ${plural(preview.trips, "viaje declarado", "viajes declarados")}`
    )
  const lines = [
    retired.length > 0
      ? `Se van a ${joinEs(retired)}.`
      : "No tiene publicaciones, ofertas ni viajes abiertos para retirar.",
  ]
  if (preview.recurringSeries > 0)
    lines.push(
      `Se corta ${plural(preview.recurringSeries, "viaje recurrente", "viajes recurrentes")}: no se generan más repeticiones.`
    )
  const n = preview.inProgressShipments.length
  lines.push(
    n > 0
      ? `${n === 1 ? "El envío en curso sigue" : `Los ${n} envíos en curso siguen`}; se avisa a las contrapartes que no puede tomar envíos nuevos.`
      : "No tiene envíos en curso."
  )
  return lines
}

/** Lo que retiró un intento, en una línea para la ficha y el cierre del diálogo. */
export function describeWithdrawn(result: WithdrawOpenActivityResult): string {
  const parts: string[] = []
  if (result.cancelledShipmentIds.length > 0)
    parts.push(
      plural(
        result.cancelledShipmentIds.length,
        "publicación cancelada",
        "publicaciones canceladas"
      )
    )
  if (result.withdrawnOfferIds.length > 0)
    parts.push(
      plural(
        result.withdrawnOfferIds.length,
        "oferta retirada",
        "ofertas retiradas"
      )
    )
  if (result.cancelledTripIds.length > 0)
    parts.push(
      plural(
        result.cancelledTripIds.length,
        "viaje cancelado",
        "viajes cancelados"
      )
    )
  if (result.stoppedRecurrenceTripIds.length > 0)
    parts.push(
      plural(
        result.stoppedRecurrenceTripIds.length,
        "serie recurrente cortada",
        "series recurrentes cortadas"
      )
    )
  return parts.length > 0
    ? `${joinEs(parts)}.`
    : "No había nada abierto para retirar."
}

/** La sanción vigente del historial (como mucho una, `svc-users` cierra la anterior al aplicar otra). */
export const activeSanctionOf = (items: AdminUserSanction[]) =>
  items.find((s) => !s.liftedAt) ?? null

/**
 * El retiro de la sanción vigente quedó a medias o sin registrar, y conviene reintentarlo (AC2). Sin
 * registro (`withdrawal: null`) puede ser una sanción migrada o una aplicada con la respuesta o la
 * bitácora caídas: el reintento es idempotente, así que se ofrece igual.
 */
export const needsWithdrawalRetry = (s: AdminUserSanction | null) =>
  !!s && !s.liftedAt && s.withdrawal?.status !== "complete"

/** Por qué se ofrece reintentar el retiro, para la ficha. */
export function withdrawalWarning(s: AdminUserSanction): string {
  if (!s.withdrawal)
    return "No hay registro del retiro de esta sanción: reintentalo para asegurarte de que no quede nada abierto."
  return s.withdrawal.status === "partial"
    ? "El retiro quedó a medias: algunas publicaciones, ofertas o viajes siguen abiertos."
    : "El último intento de retiro falló: puede que siga habiendo publicaciones, ofertas o viajes abiertos."
}
