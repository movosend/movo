import type {
  SupportConversationRow,
  SupportPriority,
  SupportStatus,
} from "@movo/shared/src/types/admin-support"

/** Todo se muestra en hora argentina: igual en el servidor y el navegador (sin desajuste al hidratar). */
const TZ = "America/Argentina/Buenos_Aires"
const clock = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ })
const shortDate = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
})
const longDate = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  day: "numeric",
  month: "long",
  year: "numeric",
})
const monthYear = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  month: "short",
  year: "numeric",
})

export const formatClock = (iso: string) => clock.format(new Date(iso))
export const formatShortDate = (iso: string) =>
  shortDate.format(new Date(iso)).replace(".", "")
export const formatMonthYear = (iso: string) =>
  monthYear.format(new Date(iso)).replace(".", "")
export const formatLongDate = (iso: string) => longDate.format(new Date(iso))

/** "Hoy", "Ayer" o la fecha: el separador de día de la conversación. */
export function dayLabel(iso: string, now = Date.now()): string {
  const key = dayKey.format(new Date(iso))
  if (key === dayKey.format(new Date(now))) return "Hoy"
  if (key === dayKey.format(new Date(now - 86_400_000))) return "Ayer"
  return formatLongDate(iso)
}
export const sameDay = (a: string, b: string) =>
  dayKey.format(new Date(a)) === dayKey.format(new Date(b))

/** Hora de hoy o fecha corta: el tiempo de las filas que no esperan. */
export function activityLabel(iso: string, now = Date.now()): string {
  return sameDay(iso, new Date(now).toISOString())
    ? formatClock(iso)
    : formatShortDate(iso)
}

export const firstName = (name: string) => name.split(/\s+/)[0] ?? name

export const isUrgent = (priority: SupportPriority) =>
  priority === "urgent" || priority === "high"

/** Punto de color de la prioridad (tokens del sistema; `normal`/`baja` en grises). */
export const PRIORITY_DOT: Record<SupportPriority, string> = {
  urgent: "bg-dot-danger",
  high: "bg-dot-warning",
  normal: "bg-muted-foreground",
  low: "bg-border-strong",
}

/** Colores del estado (píldora del encabezado). */
export const STATUS_TONE: Record<SupportStatus, { pill: string; dot: string }> =
  {
    open: { pill: "bg-info-soft text-info-fg", dot: "bg-dot-info" },
    awaiting_user: { pill: "bg-muted text-fg2", dot: "bg-muted-foreground" },
    resolved: {
      pill: "bg-success-soft text-success-fg",
      dot: "bg-dot-success",
    },
  }

export const SHIPMENT_TONE = {
  success: "bg-success-soft text-success-fg",
  danger: "bg-danger-soft text-danger-fg",
  info: "bg-info-soft text-info-fg",
  warning: "bg-warn-soft text-warn-fg",
  neutral: "bg-muted text-fg2",
} as const

/** "Vos: …" o "Lucía: …" delante del último mensaje del agente; el del usuario va sin prefijo. */
export function previewOf(row: SupportConversationRow, meId: string): string {
  const last = row.lastMessage
  if (!last) return ""
  const text = last.body.trim() || (last.hasAttachments ? "Imagen" : "")
  if (last.from === "user") return text
  return `${last.authorId === meId ? "Vos" : firstName(last.authorName)}: ${text}`
}
