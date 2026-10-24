import type {
  AdminShipmentDetail,
  AdminShipmentOffer,
} from "@movo/shared/src/types/admin-shipments"
import { formatArs, type Pill } from "@/lib/users/format"
import { formatStamp, type ShipmentStatusValue } from "./format"

/**
 * Ofertas del detalle de un envío (sección "Ofertas" y su modal). Los montos y el copy de precio
 * siguen a mobile: `$17.200`, "-7% vs. sugerido" (entero) y "Cómo se reparte" de `PriceBreakdownCard`.
 */

export type OfferStatusValue = AdminShipmentOffer["status"]

export const OFFER_STATUS: Record<OfferStatusValue, Pill & { help: string }> = {
  pending: {
    label: "Pendiente",
    tone: "info",
    help: "Esperando la respuesta del emisor.",
  },
  accepted: {
    label: "Aceptada",
    tone: "success",
    help: "El emisor eligió esta oferta.",
  },
  rejected: {
    label: "Rechazada",
    tone: "danger",
    help: "El emisor la rechazó.",
  },
  withdrawn: {
    label: "Retirada",
    tone: "warning",
    help: "El transportista la retiró antes de que el emisor decidiera.",
  },
  expired: {
    label: "Vencida",
    tone: "neutral",
    help: "Venció sin respuesta del emisor.",
  },
  superseded: {
    label: "No elegida",
    tone: "neutral",
    help: "Seguía abierta cuando el emisor eligió otra oferta.",
  },
  shipment_cancelled: {
    label: "Envío cancelado",
    tone: "neutral",
    help: "El envío se canceló y la oferta quedó sin efecto.",
  },
  assignment_lapsed: {
    label: "No se concretó",
    tone: "warning",
    help: "El emisor la eligió, pero el pago no se completó a tiempo y el envío volvió a publicarse.",
  },
  carrier_withdrawn: {
    label: "Se bajó",
    tone: "danger",
    help: "El transportista dejó el envío después de que lo eligieran y el envío volvió a publicarse.",
  },
}

/** Filtros del modal. `pending` solo aparece si hay alguna abierta. */
export const OFFER_FILTERS = {
  all: { label: "Todas", statuses: null },
  pending: { label: "Abiertas", statuses: ["pending"] },
  evaluated: {
    label: "Evaluadas por el emisor",
    statuses: [
      "accepted",
      "superseded",
      "rejected",
      "assignment_lapsed",
      "carrier_withdrawn",
    ],
  },
  dropped: {
    label: "Retiradas o vencidas",
    statuses: ["withdrawn", "expired", "shipment_cancelled"],
  },
} as const satisfies Record<
  string,
  { label: string; statuses: readonly OfferStatusValue[] | null }
>
export type OfferFilter = keyof typeof OFFER_FILTERS

export const inFilter = (offer: AdminShipmentOffer, filter: OfferFilter) => {
  const statuses: readonly string[] | null = OFFER_FILTERS[filter].statuses
  return statuses === null || statuses.includes(offer.status)
}

export const OFFER_SORTS = {
  price: "Precio",
  rating: "Reputación",
  time: "Llegada",
} as const
export type OfferSort = keyof typeof OFFER_SORTS

export function sortOffers(
  offers: AdminShipmentOffer[],
  sort: OfferSort
): AdminShipmentOffer[] {
  return [...offers].sort((a, b) => {
    if (sort === "price") return a.priceArs - b.priceArs
    if (sort === "rating")
      return (b.carrierRatingAtOffer ?? -1) - (a.carrierRatingAtOffer ?? -1)
    return a.createdAt.localeCompare(b.createdAt)
  })
}

/** Diferencia contra el sugerido en % entero, como la pantalla de ofertar de mobile. */
export function suggestedDelta(
  priceArs: number,
  suggestedArs: number | null
): number | null {
  if (!suggestedArs) return null
  return Math.round(((priceArs - suggestedArs) / suggestedArs) * 100)
}

/** "= sugerido" o "-7% vs. sugerido". */
export function deltaLabel(delta: number): string {
  return delta === 0
    ? "= sugerido"
    : `${delta > 0 ? "+" : ""}${delta}% vs. sugerido`
}

/** "=", "-7%" o "+12%": la columna de la lista. */
export function deltaShort(delta: number): string {
  return delta === 0 ? "=" : `${delta > 0 ? "+" : ""}${delta}%`
}

/** Posición por precio (1 = la más barata; los empates comparten puesto). */
export function priceRank(
  offer: AdminShipmentOffer,
  offers: AdminShipmentOffer[]
): number {
  return offers.filter((o) => o.priceArs < offer.priceArs).length + 1
}

/** "la más barata de 6", "de 6 · $300 más que la más barata" o "única oferta". */
export function rankLabel(
  offer: AdminShipmentOffer,
  offers: AdminShipmentOffer[]
): string {
  if (offers.length === 1) return "única oferta"
  const rank = priceRank(offer, offers)
  if (rank === 1) return `la más barata de ${offers.length}`
  const lowest = Math.min(...offers.map((o) => o.priceArs))
  return `de ${offers.length} · ${formatArs(offer.priceArs - lowest)} más que la más barata`
}

export interface OffersSummary {
  count: number
  accepted: AdminShipmentOffer | null
  dropped: number
  pending: number
  minArs: number
  maxArs: number
  medianArs: number
  /** Desde la primera oferta hasta que el emisor aceptó una; `null` si nunca aceptó. */
  timeToChooseMs: number | null
}

export function summarizeOffers(
  offers: AdminShipmentOffer[]
): OffersSummary | null {
  if (offers.length === 0) return null
  const prices = offers.map((o) => o.priceArs).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const medianArs =
    prices.length % 2 ? prices[mid]! : (prices[mid - 1]! + prices[mid]!) / 2
  const accepted =
    offers
      .filter((o) => o.status === "accepted")
      .sort((a, b) => (b.respondedAt ?? "").localeCompare(a.respondedAt ?? ""))
      .at(0) ?? null
  const first = Math.min(...offers.map((o) => new Date(o.createdAt).getTime()))
  return {
    count: offers.length,
    accepted,
    dropped: offers.filter((o) => inFilter(o, "dropped")).length,
    pending: offers.filter((o) => o.status === "pending").length,
    minArs: prices[0]!,
    maxArs: prices.at(-1)!,
    medianArs,
    timeToChooseMs: accepted?.respondedAt
      ? new Date(accepted.respondedAt).getTime() - first
      : null,
  }
}

/** "35 min", "2 h 12 min" o "3 días". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48)
    return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
  return `${Math.floor(hours / 24)} días`
}

const calendarDay = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
})
/** `YYYY-MM-DD` → "vie 24 oct" (sin huso: es un día de calendario). */
export const formatCalendarDay = (date: string) =>
  calendarDay.format(new Date(`${date}T12:00:00Z`)).replace(/[.,]/g, "")

const span = (start: string, end: string) => `${start}–${end}`

/**
 * Lo que pidió el emisor, no `pickupDate`/franja del envío: al aceptar una oferta, `svc-shipments` los pisa
 * con los de la oferta ganadora (MOVO-258 D3).
 */
type RequestedPickup = Pick<
  AdminShipmentDetail,
  | "requestedPickupDate"
  | "requestedPickupTimeWindowStart"
  | "requestedPickupTimeWindowEnd"
>

/** El retiro propuesto y cómo se compara con lo que pidió el emisor. */
export function offerPickup(
  offer: AdminShipmentOffer,
  shipment: RequestedPickup
): { when: string; note: string } {
  const requestedStart = shipment.requestedPickupTimeWindowStart
  const requestedEnd = shipment.requestedPickupTimeWindowEnd
  // Sin franja propia, la oferta toma la que pidió el emisor.
  const start = offer.pickupTimeWindowStart ?? requestedStart
  const end = offer.pickupTimeWindowEnd ?? requestedEnd
  const when = `${formatCalendarDay(offer.offeredDate)}, ${span(start, end)}`
  if (offer.offeredDate !== shipment.requestedPickupDate)
    return { when, note: "Propone otro día" }
  if (!offer.pickupTimeWindowStart)
    return { when, note: "Lo que pidió el emisor" }
  // "HH:MM" se compara bien como texto.
  const inside = start >= requestedStart && end <= requestedEnd
  return {
    when,
    note: inside ? "Dentro de lo pedido" : "Otro horario, mismo día",
  }
}

export function requestedPickup(shipment: RequestedPickup): string {
  return `${formatCalendarDay(shipment.requestedPickupDate)}, ${span(shipment.requestedPickupTimeWindowStart, shipment.requestedPickupTimeWindowEnd)}`
}

/** "Comisión Movo (15%)": la tasa viene del backend, no se deduce de montos ya redondeados. */
export const commissionLabel = (offer: AdminShipmentOffer) =>
  `Comisión Movo (${Math.round(offer.commissionRate * 100)}%)`

export function offerDelivery(offer: AdminShipmentOffer): string {
  if (!offer.estimatedDeliveryDate) return "Sin estimar"
  const day = formatCalendarDay(offer.estimatedDeliveryDate)
  return offer.estimatedDeliveryTimeWindowStart &&
    offer.estimatedDeliveryTimeWindowEnd
    ? `${day}, ${span(offer.estimatedDeliveryTimeWindowStart, offer.estimatedDeliveryTimeWindowEnd)}`
    : day
}

/**
 * Total de "Cómo se reparte": el `receivedAmountLabel` de mobile en tercera persona (lo lee el admin, no el
 * transportista). Resaltado en lima solo si la oferta sigue en juego, igual que mobile.
 */
export function receivedLabel(
  offer: AdminShipmentOffer,
  shipmentStatus: ShipmentStatusValue
): { label: string; highlight: boolean } {
  if (offer.status === "pending")
    return { label: "Recibe aprox.", highlight: true }
  if (offer.status === "accepted")
    return shipmentStatus === "completed"
      ? { label: "Recibió aprox.", highlight: false }
      : { label: "Va a recibir aprox.", highlight: true }
  return { label: "Habría recibido aprox.", highlight: false }
}

const CLOSED_VERB: Partial<Record<OfferStatusValue, string>> = {
  accepted: "Aceptada",
  rejected: "Rechazada",
  withdrawn: "Retirada",
  superseded: "Cerrada",
  shipment_cancelled: "Cerrada",
  assignment_lapsed: "Cerrada",
  carrier_withdrawn: "Se bajó",
}

/** El recorrido de la oferta: cuándo llegó, si el emisor la vio y cómo terminó. */
export function offerLife(
  offer: AdminShipmentOffer
): Array<{ label: string; value: string }> {
  const life = [
    { label: "Ofertó", value: formatStamp(offer.createdAt) },
    {
      label: "Vista por el emisor",
      value: offer.viewedAtBySender
        ? formatStamp(offer.viewedAtBySender)
        : "Nunca",
    },
  ]
  if (offer.status === "pending") {
    if (offer.expiresAt)
      life.push({ label: "Vence", value: formatStamp(offer.expiresAt) })
  } else if (offer.status === "expired") {
    // La expiración es perezosa: una vencida suele no tener `respondedAt`.
    const at = offer.respondedAt ?? offer.expiresAt
    if (at) life.push({ label: "Venció", value: formatStamp(at) })
  } else if (offer.respondedAt) {
    life.push({
      label: CLOSED_VERB[offer.status] ?? "Cerrada",
      value: formatStamp(offer.respondedAt),
    })
  }
  return life
}

/**
 * `svc-shipments` deja en el evento de aceptación `Oferta <id> aceptada · <ruta de la saga>` (MOVO-210).
 * Se separa en el id (para abrir esa oferta) y etiquetas legibles; si el texto no tiene esa forma, `null`
 * y el evento muestra su motivo tal cual.
 */
export function parseAcceptance(
  reason: string | null
): { offerId: string; tags: string[] } | null {
  const match = reason?.match(/^Oferta ([0-9a-f-]{36}) aceptada · (.+)$/i)
  if (!match) return null
  const [, offerId, route] = match as unknown as [string, string, string]
  const near = route.startsWith("ruta cercana")
  const far = route.startsWith("ruta lejana")
  if (!near && !far)
    return { offerId, tags: [route.charAt(0).toUpperCase() + route.slice(1)] }
  const tags = [near ? "Ruta cercana" : "Ruta lejana"]
  // Los días pueden ser enteros ("2") o negativos ("-0.3": la franja de retiro ya había empezado al aceptar).
  const days = route.match(
    /retiro en (-?[\d.]+) días \((?:dentro de|a más de) (\d+)\)/
  )
  if (days)
    tags.push(
      Number(days[1]) < 0
        ? "Retiro ya empezado al aceptar"
        : `Retiro en ${days[1]!.replace(".", ",")} días (N = ${days[2]})`
    )
  tags.push(near ? "Paga al aceptar" : "Paga al abrirse la ventana")
  return { offerId, tags }
}
