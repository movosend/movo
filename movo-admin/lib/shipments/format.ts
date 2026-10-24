import {
  isAdminShipmentAlert,
  type AdminChatMessage,
  type AdminChatReport,
  type AdminShipmentEvent,
  type AdminShipmentGroup,
  type AdminShipmentPayment,
  type AdminShipmentRow,
} from "@movo/shared/src/types/admin-shipments"
import type {
  ChatAccess,
  ChatParticipantRole,
} from "@movo/shared/src/types/chat"
import { formatArs, type Pill } from "@/lib/users/format"

export type ShipmentStatusValue = AdminShipmentRow["status"]
export type ShipmentTab = "all" | AdminShipmentGroup

/** Todo en hora argentina, igual en el servidor y en el navegador (sin desajuste al hidratar). */
const TZ = "America/Argentina/Buenos_Aires"
const clock = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ })
const shortDay = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
})
const longDay = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
})

export const formatClock = (iso: string) => clock.format(new Date(iso))
export const formatShortDay = (iso: string) =>
  shortDay.format(new Date(iso)).replace(".", "")
/** "21 oct · 09:24": la hora de un evento. */
export const formatStamp = (iso: string) =>
  `${formatShortDay(iso)} · ${formatClock(iso)}`
/** `YYYY-MM-DD` del día argentino de un instante. */
export const argentinaDay = (date: Date) => dayKey.format(date)

export const TAB_LABEL: Record<ShipmentTab, string> = {
  all: "Todos",
  unassigned: "Sin asignar",
  assigning: "Asignando",
  in_progress: "En curso",
  closed: "Cerrados",
  disputes: "Disputas",
}

export const ROLE_LABEL: Record<ChatParticipantRole, string> = {
  sender: "Emisor",
  carrier: "Transportista",
  receiver: "Receptor",
}

export const PACKAGE_TYPE_LABEL: Record<string, string> = {
  letter_document: "Sobre o documento",
  standard_package: "Paquete estándar",
  fragile_item: "Frágil",
}

const firstOf = (name: string | null) => name?.trim().split(/\s+/)[0] ?? null
/** "Ana Martínez" → "Ana M.". */
export function shortName(name: string | null): string {
  if (!name?.trim()) return "Sin nombre"
  const [first, ...rest] = name.trim().split(/\s+/)
  const last = rest.at(-1)
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first!
}
export const firstName = (name: string | null) => firstOf(name) ?? "Sin nombre"

/** "Ana M. → Luis H. · vía Diego F." */
export function partiesLine(row: AdminShipmentRow): string {
  const base = `${shortName(row.sender.name)} → ${shortName(row.receiver.name)}`
  return row.carrier ? `${base} · vía ${shortName(row.carrier.name)}` : base
}

export const routeLine = (row: AdminShipmentRow) =>
  `${row.pickupCity ?? "Sin ciudad"} → ${row.deliveryCity ?? "Sin ciudad"}`

export const addressLine = (row: AdminShipmentRow) =>
  `${row.pickupAddress} → ${row.deliveryAddress}`

/** "Hoy · 09:00 a 12:00 hs", "Mañana · …" o "24 oct · …": la ventana de retiro (como el prototipo). */
export function pickupWindow(row: AdminShipmentRow, now = new Date()): string {
  const span = `${row.pickupTimeWindowStart} a ${row.pickupTimeWindowEnd} hs`
  const today = argentinaDay(now)
  const tomorrow = argentinaDay(new Date(now.getTime() + 86_400_000))
  if (row.pickupDate === today) return `Hoy · ${span}`
  if (row.pickupDate === tomorrow) return `Mañana · ${span}`
  // Mediodía UTC: el huso no corre el día de una fecha sin hora.
  return `${formatShortDay(`${row.pickupDate}T12:00:00Z`)} · ${span}`
}

export function priceLabel(row: Pick<AdminShipmentRow, "priceArs">): string {
  return row.priceArs === null ? "A estimar" : formatArs(row.priceArs)
}

/** "hace 4 min", "hace 3 h", "ayer" o la fecha. */
export function timeAgo(iso: string, now = new Date()): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return "recién"
  if (minutes < 60) return `hace ${minutes} min`
  if (minutes < 24 * 60 && argentinaDay(new Date(iso)) === argentinaDay(now))
    return `hace ${Math.floor(minutes / 60)} h`
  if (
    argentinaDay(new Date(iso)) ===
    argentinaDay(new Date(now.getTime() - 86_400_000))
  )
    return `ayer ${formatClock(iso)}`
  return formatShortDay(iso)
}

/** Lo que falta hasta `iso`: "40 min", "5 h", "2 días". `null` si ya pasó. */
export function timeLeft(iso: string, now = new Date()): string | null {
  const minutes = Math.floor((new Date(iso).getTime() - now.getTime()) / 60_000)
  if (minutes < 0) return null
  if (minutes < 60) return `${Math.max(1, minutes)} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.floor(hours / 24)} días`
}

/**
 * Texto del aviso de una fila, o `null`. Si lleva aviso lo decide `isAdminShipmentAlert` (la regla
 * del filtro `alert` del listado); acá solo se elige el texto.
 */
export function rowAlert(
  row: AdminShipmentRow,
  now = new Date()
): string | null {
  if (!isAdminShipmentAlert(row)) return null
  if (row.delayed) return "Demorado · sigue en camino más de lo esperado"
  if (row.status === "assigned_unfunded") {
    if (!row.fundingDeadline) return "Esperando que el emisor reserve el pago"
    const left = timeLeft(row.fundingDeadline, now)
    return left
      ? `La ventana de pago vence en ${left}`
      : "La ventana de pago ya venció"
  }
  if (row.status === "rejected_by_receiver") {
    const left = row.redesignationDeadline
      ? timeLeft(row.redesignationDeadline, now)
      : null
    return left
      ? `El receptor rechazó · el emisor tiene ${left} para elegir otro`
      : "El receptor rechazó el envío"
  }
  if (row.status === "disputed") return "En disputa · el pago queda retenido"
  return "Requiere atención"
}

/** Qué mirar según el estado, debajo del aviso del detalle (prototipo). */
export const ALERT_HINT: Partial<Record<ShipmentStatusValue, string>> = {
  in_transit: "El envío sigue en camino. Revisá el chat antes de intervenir.",
  assigned_unfunded:
    "Si el emisor no confirma el pago a tiempo, el barrido devuelve el envío a Publicado.",
  disputed:
    "En disputa no tiene salida en el flujo: se resuelve con un cambio de estado del equipo.",
  rejected_by_receiver: "Si vence el plazo, el barrido cancela el envío.",
}

// ── Partes ─────────────────────────────────────────────────────────────────────

type Parties = Pick<AdminShipmentRow, "sender" | "carrier" | "receiver">

/** Quién hizo un evento: una de las partes, el sistema (`null`) u otra cuenta (un receptor anterior). */
export function actorLabel(actorId: string | null, row: Parties): string {
  if (!actorId) return "Sistema"
  for (const role of ["sender", "carrier", "receiver"] as const) {
    const party = row[role]
    if (party?.id === actorId)
      return `${party.name ?? "Sin nombre"} · ${ROLE_LABEL[role]}`
  }
  return `Cuenta ${actorId.slice(0, 8)}`
}

/** "Ana, Diego y Luis": título del chat. */
export function chatTitle(row: Parties): string {
  const names = [row.sender, row.carrier, row.receiver]
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => firstName(p.name))
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`
    : (names[0] ?? "")
}

export const CHAT_ACCESS_LABEL: Record<ChatAccess, string> = {
  open: "las partes pueden escribir",
  read_only: "las partes solo leen",
  closed: "las partes ya no ven el hilo",
}

/** "Luis reportó esta conversación · 21 oct · 12:16". */
export function reportLine(report: AdminChatReport, row: Parties): string {
  const party =
    (report.reporterRole && row[report.reporterRole]) ||
    [row.sender, row.carrier, row.receiver].find(
      (p) => p?.id === report.reporterId
    )
  const who = party ? firstName(party.name) : "Una de las partes"
  return `${who} reportó esta conversación · ${formatStamp(report.createdAt)}`
}

// ── Línea de tiempo ────────────────────────────────────────────────────────────

/** El camino feliz: lo que se muestra en gris punteado como "por venir". */
const HAPPY: readonly ShipmentStatusValue[] = [
  "awaiting_receiver_confirmation",
  "published",
  "assignment_pending",
  "assigned",
  "in_transit",
  "delivered",
  "completed",
]

export function pendingSteps(
  status: ShipmentStatusValue
): ShipmentStatusValue[] {
  if (status === "assigned_unfunded")
    return ["assigned", "in_transit", "delivered", "completed"]
  const i = HAPPY.indexOf(status)
  return i < 0 ? [] : HAPPY.slice(i + 1)
}

export function pendingLabel(step: ShipmentStatusValue, row: Parties): string {
  const receiver = firstName(row.receiver.name)
  const labels: Partial<Record<ShipmentStatusValue, string>> = {
    published: `Aceptación de ${receiver}`,
    assignment_pending: "Elección del transportista",
    assigned: "Reserva del pago",
    in_transit: "Retiro del paquete",
    delivered: `Entrega a ${receiver}`,
    completed: "Liberación del pago",
  }
  return labels[step] ?? step
}

export interface TimelineItem {
  key: string
  status: ShipmentStatusValue
  title: string
  detail: string | null
  /** Hora y actor; `null` en un paso pendiente. */
  meta: string | null
  reason: string | null
  pending: boolean
  current: boolean
}

function eventCopy(
  event: AdminShipmentEvent,
  row: Parties
): { title: string; detail: string | null } {
  const receiver = firstName(row.receiver.name)
  const carrier = firstName(row.carrier?.name ?? null)
  switch (event.toStatus) {
    case "awaiting_receiver_confirmation":
      return event.fromStatus
        ? {
            title: `Se le volvió a pedir a ${receiver} que confirme`,
            detail: null,
          }
        : {
            title: "Envío creado",
            detail: "Esperando que el receptor lo acepte",
          }
    case "rejected_by_receiver":
      return {
        title: `${receiver} rechazó el envío`,
        detail: "El emisor puede elegir otro receptor",
      }
    case "published":
      return event.fromStatus === "awaiting_receiver_confirmation"
        ? {
            title: `${receiver} aceptó el envío`,
            detail: "Publicado para transportistas",
          }
        : { title: "Volvió a publicarse", detail: "Abierto otra vez a ofertas" }
    case "assignment_pending":
      return {
        title: `El emisor eligió a ${carrier}`,
        detail: "Falta reservar el pago",
      }
    case "assigned_unfunded":
      return {
        title: `El emisor eligió a ${carrier}`,
        detail: "El pago se reserva más cerca del retiro",
      }
    case "assigned":
      return {
        title: "Pago reservado",
        detail: "Hold autorizado en Mercado Pago",
      }
    case "in_transit":
      return {
        title: "El paquete salió en camino",
        detail: "Handshake de retiro con QR",
      }
    case "delivered":
      return {
        title: "Paquete entregado",
        detail: "Handshake de entrega con QR",
      }
    case "completed":
      return {
        title: "Pago liberado, envío cerrado",
        detail: "Captura y reparto confirmados",
      }
    case "cancelled":
      return { title: "Envío cancelado", detail: null }
    case "disputed":
      return { title: "Envío en disputa", detail: null }
  }
}

/** Eventos reales (del más viejo al más nuevo) y, después, los pasos que faltan. */
export function buildTimeline(
  events: AdminShipmentEvent[],
  row: AdminShipmentRow
): TimelineItem[] {
  const sorted = [...events].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )
  const done = sorted.map((event, i): TimelineItem => {
    const copy = eventCopy(event, row)
    return {
      key: event.id,
      status: event.toStatus,
      ...copy,
      meta: `${formatStamp(event.createdAt)} · ${actorLabel(event.actorId, row)}`,
      reason: event.reason,
      pending: false,
      current: i === sorted.length - 1,
    }
  })
  const pending = pendingSteps(row.status).map((step): TimelineItem => ({
    key: `pending-${step}`,
    status: step,
    title: pendingLabel(step, row),
    detail: null,
    meta: null,
    reason: null,
    pending: true,
    current: false,
  }))
  return [...done, ...pending]
}

// ── Retiro, entrega y pago ─────────────────────────────────────────────────────

const PICKED: readonly ShipmentStatusValue[] = [
  "in_transit",
  "delivered",
  "completed",
]
const DROPPED: readonly ShipmentStatusValue[] = ["delivered", "completed"]

export interface Handshake {
  done: boolean
  text: string
}

/**
 * Estado del handshake de cada tramo. La hora sale del evento que lo confirmó; sin eventos
 * (el bloque falló) se deduce del estado actual y se dice sin hora.
 */
export function handshakes(
  row: AdminShipmentRow,
  events: AdminShipmentEvent[] | null
): { pickup: Handshake; delivery: Handshake } {
  const last = (status: ShipmentStatusValue) =>
    events
      ?.filter((e) => e.toStatus === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const pickupEvent = last("in_transit")
  const deliveryEvent = last("delivered")
  const picked = !!pickupEvent || PICKED.includes(row.status)
  const dropped = !!deliveryEvent || DROPPED.includes(row.status)
  return {
    pickup: picked
      ? {
          done: true,
          text: pickupEvent
            ? `Retiro confirmado con QR · ${formatClock(pickupEvent.createdAt)}`
            : "Retiro confirmado con QR",
        }
      : { done: false, text: "Retiro pendiente" },
    delivery: dropped
      ? {
          done: true,
          text: deliveryEvent
            ? `Entrega confirmada con QR · ${formatClock(deliveryEvent.createdAt)}`
            : "Entrega confirmada con QR",
        }
      : { done: false, text: "Entrega pendiente" },
  }
}

const NO_HOLD: Partial<Record<ShipmentStatusValue, string>> = {
  awaiting_receiver_confirmation: "Sin pago todavía",
  rejected_by_receiver: "Sin pago todavía",
  published: "Sin pago todavía",
  assignment_pending: "Esperando que el emisor pague",
  assigned_unfunded: "Ventana de pago abierta",
  cancelled: "Sin cargo",
}

const HOLD_FAILURE: Record<string, string> = {
  insufficient_funds: "fondos insuficientes",
  card_rejected: "tarjeta rechazada",
  invalid_data: "datos inválidos",
  platform_error: "error de la plataforma",
}

/** Estado del pago en Mercado Pago, en una línea. */
export function paymentLabel(
  payment: AdminShipmentPayment,
  status: ShipmentStatusValue
): Pill {
  if (!payment) return { label: NO_HOLD[status] ?? "Sin hold", tone: "neutral" }
  switch (payment.status) {
    case "creating":
      return { label: "Creando la reserva", tone: "info" }
    case "in_process":
      return { label: "En revisión de Mercado Pago", tone: "warning" }
    case "authorized":
      return status === "disputed"
        ? { label: "Retenido por la disputa", tone: "warning" }
        : { label: "Hold autorizado", tone: "info" }
    case "captured":
      return { label: "Capturado", tone: "success" }
    case "cancelled":
      return {
        label: payment.wasAuthorized
          ? "Hold liberado, sin cargo"
          : "Reserva cancelada",
        tone: "neutral",
      }
    case "rejected":
      return {
        label: `Rechazado${payment.failureReason ? ` · ${HOLD_FAILURE[payment.failureReason] ?? payment.failureReason}` : ""}`,
        tone: "danger",
      }
  }
}

export function formatWeight(kg: number): string {
  return `${kg.toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg`
}

// ── Chat ───────────────────────────────────────────────────────────────────────

const CHAT_EVENT_LABEL: Record<ShipmentStatusValue, string> = {
  awaiting_receiver_confirmation: "Envío creado",
  rejected_by_receiver: "El receptor rechazó",
  published: "Publicado",
  assignment_pending: "Transportista elegido",
  assigned_unfunded: "Transportista elegido",
  assigned: "Pago reservado",
  in_transit: "Retiro confirmado",
  delivered: "Entregado",
  completed: "Pago liberado",
  cancelled: "Envío cancelado",
  disputed: "Envío en disputa",
}

export type ChatItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "event"; key: string; label: string; time: string }
  | {
      kind: "message"
      key: string
      message: AdminChatMessage
      name: string
      role: string | null
      time: string
      /** Primer mensaje de una racha del mismo autor: lleva nombre y avatar. */
      head: boolean
    }

function dayLabel(iso: string, now: Date): string {
  const key = argentinaDay(new Date(iso))
  if (key === argentinaDay(now)) return "Hoy"
  if (key === argentinaDay(new Date(now.getTime() - 86_400_000))) return "Ayer"
  const label = longDay.format(new Date(iso))
  return label[0]!.toUpperCase() + label.slice(1)
}

/**
 * Hilo para mostrar: mensajes del más viejo al más nuevo con los eventos del envío intercalados
 * por fecha y separadores de día. Con más páginas por cargar, los eventos anteriores al mensaje
 * más viejo se guardan para cuando lleguen esos mensajes.
 */
export function buildChatItems(
  messages: AdminChatMessage[],
  events: AdminShipmentEvent[],
  complete: boolean,
  now = new Date()
): ChatItem[] {
  const ordered = [...messages].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )
  const oldest = ordered[0]?.createdAt
  const shown = events.filter(
    (e) => complete || (oldest !== undefined && e.createdAt >= oldest)
  )
  type Entry = {
    at: string
    event?: AdminShipmentEvent
    message?: AdminChatMessage
  }
  const entries: Entry[] = [
    ...ordered.map((message) => ({ at: message.createdAt, message })),
    ...shown.map((event) => ({ at: event.createdAt, event })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  const items: ChatItem[] = []
  let day = ""
  let prevAuthor: string | null = null
  for (const entry of entries) {
    const key = argentinaDay(new Date(entry.at))
    if (key !== day) {
      day = key
      prevAuthor = null
      items.push({
        kind: "day",
        key: `day-${key}`,
        label: dayLabel(entry.at, now),
      })
    }
    if (entry.event) {
      prevAuthor = null
      items.push({
        kind: "event",
        key: `ev-${entry.event.id}`,
        label: CHAT_EVENT_LABEL[entry.event.toStatus],
        time: formatClock(entry.at),
      })
      continue
    }
    const message = entry.message!
    items.push({
      kind: "message",
      key: message.id,
      message,
      name: message.authorName ?? "Sin nombre",
      role: message.authorRole ? ROLE_LABEL[message.authorRole] : null,
      time: formatClock(message.createdAt),
      head: prevAuthor !== message.authorId,
    })
    prevAuthor = message.authorId
  }
  return items
}

/**
 * Código del envío para mostrar, igual que el de la app (`activeShipmentDisplayCode` en movo-mobile):
 * los últimos 5 dígitos del id, rellenados con ceros. Solo para mostrar: no identifica al envío ni sirve para buscarlo.
 */
export function shipmentDisplayCode(id: string): string {
  const digits = id.replace(/\D/g, "").slice(-5).padStart(5, "0")
  return `#MOVO-${digits}`
}
