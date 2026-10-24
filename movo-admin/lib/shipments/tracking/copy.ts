import type { AdminShipmentTracking, TrackingReason } from "./types"

export interface TrackingMessage {
  title: string
  body: string
}

/** Textos del prototipo para los estados sin mapa en vivo (MOVO-328 AC6). */
export function trackingMessage(t: AdminShipmentTracking): TrackingMessage {
  const who = t.carrierFirstName ?? "El transportista"
  const reason: TrackingReason | null = t.reason
  switch (reason) {
    case "awaiting_pickup":
      return {
        title: "Todavía no arrancó",
        body: t.pickupWindow
          ? `El seguimiento se abre con el retiro. ${who} retira en la ventana ${t.pickupWindow}.`
          : "El seguimiento se abre con el retiro.",
      }
    case "unfunded":
      return {
        title: "Todavía no arrancó",
        body: "Sin fondos reservados el envío no se puede retirar ni seguir.",
      }
    case "delivered":
      return {
        title: "Seguimiento cerrado",
        body: "Se cortó con el handshake de entrega. La traza queda guardada hasta la purga periódica.",
      }
    case "completed":
      return {
        title: "Seguimiento cerrado",
        body: "Se cortó con la entrega. La traza queda guardada hasta la purga periódica.",
      }
    case "disputed":
      return {
        title: "Seguimiento cortado",
        body: "La traza GPS se conserva como evidencia mientras dure la disputa.",
      }
    default:
      return {
        title: "Sin seguimiento",
        body: "El envío no tiene transportista asignado.",
      }
  }
}
