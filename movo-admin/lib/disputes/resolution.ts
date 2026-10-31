import { splitDisputeStake } from "@movo/shared/src/config/dispute-resolution"
import type { DisputeOutcome } from "@movo/shared/src/types/dispute"
import type { AdminDisputeResolutionPreview } from "@movo/shared/src/types/admin-disputes"
import { formatArs } from "@/lib/users/format"

/** Cómo se reparte un resultado `partial`: un porcentaje predefinido o un monto libre. */
export type PartialChoice =
  { kind: "preset"; percentage: number } | { kind: "amount"; raw: string }

export interface Split {
  carrierAmountArs: number
  senderAmountArs: number
  /** Texto para mostrar en el formulario; `null` si el reparto es válido y confirmable. */
  error: string | null
}

const digits = (raw: string): number | null => {
  const n = parseInt(String(raw).replace(/\D/g, ""), 10)
  return Number.isNaN(n) ? null : n
}

/**
 * El reparto que el admin está armando, con las mismas reglas que `svc-admin` (`splitDisputeStake` y el
 * mínimo de la captura parcial): así el formulario no deja confirmar lo que el backend va a rechazar con 422.
 * El backend sigue siendo el que decide; esto solo adelanta el mensaje.
 */
export function computeSplit(
  preview: AdminDisputeResolutionPreview,
  outcome: DisputeOutcome,
  choice: PartialChoice,
  carrierName: string
): Split {
  const stake = preview.stakeArs
  if (outcome !== "partial") {
    const split = splitDisputeStake(stake, outcome, {})
    if ("error" in split)
      return {
        carrierAmountArs: 0,
        senderAmountArs: 0,
        error: "Resultado inválido.",
      }
    return { ...split, error: null }
  }

  let carrierAmountArs = 0
  let error: string | null = null
  if (choice.kind === "preset") {
    const split = splitDisputeStake(stake, outcome, {
      percentage: choice.percentage,
    })
    if ("error" in split) error = "Elegí uno de los porcentajes predefinidos."
    else carrierAmountArs = split.carrierAmountArs
  } else {
    const amount = digits(choice.raw)
    if (!choice.raw) error = `Ingresá cuánto conserva ${carrierName}.`
    else if (amount === null || amount <= 0)
      error = "El monto tiene que ser mayor que cero."
    else if (amount >= stake)
      error = `Con ${formatArs(stake)} o más no es un reparto: elegí «A favor del transportista».`
    else carrierAmountArs = amount
  }
  if (
    !error &&
    preview.minimumPartialArs !== null &&
    carrierAmountArs < preview.minimumPartialArs
  )
    error = `Con ${formatArs(carrierAmountArs)} a ${carrierName} la captura no cubre la comisión de la reserva más la de Mercado Pago. El mínimo es ${formatArs(preview.minimumPartialArs)}.`
  return {
    carrierAmountArs,
    senderAmountArs: Math.max(
      0,
      Math.round((stake - carrierAmountArs) * 100) / 100
    ),
    error,
  }
}

/** ¿Se puede pasar al siguiente paso / confirmar? El razonamiento es obligatorio (mínimo del backend). */
export const canConfirm = (
  split: Split,
  reasoning: string,
  ack: boolean,
  minReasoning: number
): boolean => !split.error && ack && reasoning.trim().length >= minReasoning
