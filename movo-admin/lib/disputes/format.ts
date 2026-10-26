import { DisputeReason, DisputeStatus } from "@movo/shared/src/types/dispute"
import type {
  DisputeOutcome,
  DisputePartyRole,
  DisputePaymentAction,
} from "@movo/shared/src/types/dispute"
import type { Pill } from "@/lib/users/format"
import { formatArs } from "@/lib/users/format"

export const DISPUTE_STATUS_TAB: Record<DisputeStatus, string> = {
  [DisputeStatus.OPEN]: "Abiertas",
  [DisputeStatus.RESOLVING]: "Procesando pago",
  [DisputeStatus.RESOLVED]: "Resueltas",
}

export const DISPUTE_STATUS_PILL: Record<DisputeStatus, Pill> = {
  [DisputeStatus.OPEN]: { label: "Abierta", tone: "warning" },
  [DisputeStatus.RESOLVING]: { label: "Procesando pago", tone: "danger" },
  [DisputeStatus.RESOLVED]: { label: "Resuelta", tone: "success" },
}

export const DISPUTE_REASON_LABEL: Record<DisputeReason, string> = {
  [DisputeReason.DAMAGED]: "Daño",
  [DisputeReason.NOT_DELIVERED]: "No entregado",
  [DisputeReason.WRONG_DELIVERY]: "Entrega equivocada",
  [DisputeReason.OTHER]: "Otro motivo",
  [DisputeReason.TRANSIT_ANOMALY]: "Anomalía en tránsito",
  [DisputeReason.PICKUP_NO_SHOW]: "Retiro no realizado",
}

/** Las abiertas por el barrido (sin una parte que reclame): se distinguen en la bandeja y el expediente. */
export const isSystemReason = (reason: DisputeReason): boolean =>
  reason === DisputeReason.TRANSIT_ANOMALY ||
  reason === DisputeReason.PICKUP_NO_SHOW

export const PARTY_ROLE_LABEL: Record<DisputePartyRole, string> = {
  sender: "emisor",
  receiver: "receptor",
  carrier: "transportista",
}

/** "Carolina Sánchez · receptora" o "Sistema" si la abrió el barrido. */
export const openedByLabel = (
  role: DisputePartyRole | null,
  name: string | null
): string =>
  role === null
    ? "Sistema"
    : `${name ?? "Sin nombre"} · ${PARTY_ROLE_LABEL[role]}`

/** Antigüedad en días enteros de calendario corrido; sin semáforo (el plazo del descargo no está definido). */
export function ageLabel(openedAt: string, now = new Date()): string {
  const hours = Math.floor(
    (now.getTime() - new Date(openedAt).getTime()) / 3_600_000
  )
  if (hours < 1) return "recién abierta"
  if (hours < 24) return `${hours} h abierta`
  const days = Math.floor(hours / 24)
  return days === 1 ? "1 día abierta" : `${days} días abierta`
}

export const OUTCOME_LABEL: Record<DisputeOutcome, string> = {
  sender: "A favor del emisor",
  carrier: "A favor del transportista",
  partial: "Parcial",
}

/** Qué se ejecuta sobre el pago, en palabras del equipo. */
export const PAYMENT_ACTION_LABEL: Record<DisputePaymentAction, string> = {
  release_hold: "Se libera la reserva del emisor",
  capture_hold: "Se cobra la reserva completa al emisor",
  capture_partial: "Se cobra solo una parte de la reserva",
  refund_full: "Se reembolsa el total al emisor",
  refund_partial: "Se reembolsa una parte al emisor",
  ledger_credit: "Se acredita al transportista en su cuenta corriente",
  none: "No se mueve plata",
}

export const FINAL_STATUS_LABEL: Record<"completed" | "cancelled", string> = {
  completed: "Completado",
  cancelled: "Cancelado",
}

/** "Valentina conserva $2.500 · Carolina $2.500" para el reparto de una resolución. */
export function splitLine(
  outcome: DisputeOutcome,
  carrierName: string,
  senderName: string,
  carrierAmountArs: number,
  senderAmountArs: number
): string {
  if (outcome === "carrier")
    return `${carrierName} conserva ${formatArs(carrierAmountArs)}`
  if (outcome === "sender")
    return `${senderName} recupera ${formatArs(senderAmountArs)}`
  return `${carrierName} conserva ${formatArs(carrierAmountArs)} · ${senderName} ${formatArs(senderAmountArs)}`
}
