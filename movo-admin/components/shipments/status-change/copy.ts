import type {
  ShipmentStatusOption,
  ShipmentStatusOptions,
} from "@movo/shared/src/types/admin-shipments"
import type { ShipmentStatusValue } from "@/lib/shipments/format"
import { SHIPMENT_STATUS } from "@/lib/users/format"

/** Los textos y colores de cada nivel de riesgo. Qué riesgo tiene cada destino lo dice el backend. */
export const RISK: Record<
  ShipmentStatusOption["risk"],
  { label: string; text: string; badge: string; box: string }
> = {
  medium: {
    label: "Riesgo medio",
    text: "Afecta a las partes, pero se puede corregir después.",
    badge: "bg-info-soft text-info-fg",
    box: "bg-info-soft text-info-fg",
  },
  high: {
    label: "Riesgo alto",
    text: "Mueve plata o la custodia del paquete. Revisalo antes de seguir.",
    badge: "bg-warn-soft text-warn-fg",
    box: "bg-warn-soft text-warn-fg",
  },
  critical: {
    label: "Riesgo crítico",
    text: "Mueve plata de forma irreversible o saltea la verificación entre las partes.",
    badge: "bg-danger-soft text-danger-fg",
    box: "bg-danger-soft text-danger-fg",
  },
}

const RECIPIENT: Record<ShipmentStatusOption["notifies"][number], string> = {
  sender: "emisor",
  receiver: "receptor",
  carrier: "transportista",
}

/** "Emisor, receptor y transportista" / "Emisor y receptor". */
export function recipientsText(
  notifies: ShipmentStatusOption["notifies"]
): string {
  const names = notifies.map((who) => RECIPIENT[who])
  const text =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
      : (names[0] ?? "")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const statusLabel = (status: ShipmentStatusValue) =>
  SHIPMENT_STATUS[status].label

/** Por qué no hay nada para elegir en el flujo, según el estado de partida. */
export function noFlowText(current: ShipmentStatusValue): string {
  if (current === "disputed")
    return "En disputa no tiene salida en el flujo: se resuelve con la resolución de la disputa, no desde este modal."
  if (current === "cancelled" || current === "completed")
    return `${statusLabel(current)} es un estado terminal: no tiene pasos siguientes.`
  return "No hay pasos siguientes en el flujo."
}

/** La opción que se preselecciona: la primera del flujo normal. */
export function defaultTarget(
  options: ShipmentStatusOptions
): ShipmentStatusValue | null {
  return options.options.find((o) => o.kind === "manual")?.targetStatus ?? null
}

export function newIdempotencyKey(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === "function") return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
