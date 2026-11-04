import type {
  AdminOverview,
  AdminOverviewBlockName,
  AdminOverviewBlocks,
  OverviewInbox,
} from "@movo/shared/src/types/admin-reports"
import { DISPUTE_REASON_LABEL } from "@/lib/disputes/format"
import { TOPIC_LABEL } from "@/lib/support/labels"
import { ageShort } from "./format"

/**
 * Las ocho bandejas de Inicio (prototipo `Movo Admin Reportes v2`, MOVO-345). Los números salen de
 * `GET /admin/overview` (MOVO-342). Las que todavía no tienen pantalla propia (KYC, reportes y
 * mensajes señalados) llevan a la sección más cercana.
 */
export interface InboxDef {
  id: AdminOverviewBlockName
  title: string
  icon:
    | "Scale"
    | "Headset"
    | "BadgeCheck"
    | "Flag"
    | "TriangleAlert"
    | "Wallet"
    | "MessageSquareWarning"
    | "ShieldAlert"
  href: string
  cta: string
  sub: (data: never) => string
  chips: Record<string, string>
}

/** Los datos de cada bandeja, sin el sobre `{ data, error }`. */
export type AdminOverviewData = {
  [K in AdminOverviewBlockName]: NonNullable<AdminOverviewBlocks[K]["data"]>
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

function def<K extends AdminOverviewBlockName>(
  id: K,
  rest: Omit<InboxDef, "id" | "sub"> & {
    sub: (data: AdminOverviewData[K]) => string
  }
): InboxDef {
  return { id, ...rest, sub: rest.sub as (data: never) => string }
}

export const INBOXES: InboxDef[] = [
  def("disputes", {
    title: "Disputas abiertas",
    icon: "Scale",
    href: "/disputes",
    cta: "Abrir disputas",
    sub: (d) =>
      d.awaitingPayment
        ? `${d.awaitingPayment} esperando que se confirme el pago`
        : "Ninguna esperando el pago",
    chips: DISPUTE_REASON_LABEL,
  }),
  def("support", {
    title: "Conversaciones sin responder",
    icon: "Headset",
    href: "/support",
    cta: "Abrir soporte",
    sub: (d) =>
      d.urgent ? plural(d.urgent, "urgente", "urgentes") : "Ninguna urgente",
    chips: TOPIC_LABEL,
  }),
  def("kyc", {
    title: "KYC por revisar",
    icon: "BadgeCheck",
    href: "/users",
    cta: "Abrir usuarios",
    sub: (d) =>
      `${plural(d.carriers, "transportista", "transportistas")}, ${plural(d.senders, "emisor", "emisores")}`,
    chips: {
      selfie_doubtful: "Selfie dudosa",
      document_expired: "DNI vencido",
      document_unreadable: "DNI ilegible",
      data_mismatch: "Datos no coinciden",
    },
  }),
  def("userReports", {
    title: "Reportes de usuarios",
    icon: "Flag",
    href: "/users",
    cta: "Abrir usuarios",
    sub: (d) =>
      d.blockRequested
        ? `${d.blockRequested} ${d.blockRequested === 1 ? "pide" : "piden"} bloqueo`
        : "Ninguno pide bloqueo",
    chips: {
      inappropriate_behavior: "Trato inapropiado",
      no_show: "No se presentó",
      fraud: "Fraude",
      off_platform_payment: "Cobro por fuera",
      other: "Otro",
    },
  }),
  def("shipmentAlerts", {
    title: "Envíos con alerta",
    icon: "TriangleAlert",
    href: "/shipments?alert=1",
    cta: "Abrir envíos",
    sub: (d) =>
      d.inTransit ? `${d.inTransit} en viaje ahora` : "Ninguno en viaje",
    chips: {
      signal_lost: "GPS perdido",
      pickup_delayed: "Retiro demorado",
      delivery_delayed: "Entrega demorada",
      unfunded: "Sin fondos",
    },
  }),
  def("payments", {
    title: "Pagos por revisar",
    icon: "Wallet",
    href: "/shipments",
    cta: "Abrir envíos",
    sub: (d) =>
      d.holdsExpiringToday
        ? `${plural(d.holdsExpiringToday, "hold vence", "holds vencen")} hoy`
        : "Ningún hold vence hoy",
    chips: {
      dispute_resolving: "Disputa en resolución",
      capture_failed: "Captura fallida",
      hold_expiring: "Hold por vencer",
      escalated: "Escalado",
    },
  }),
  def("flaggedMessages", {
    title: "Mensajes señalados",
    icon: "MessageSquareWarning",
    href: "/shipments",
    cta: "Abrir envíos",
    sub: () => "moderados por el filtro del chat",
    chips: {
      insults: "Insultos",
      contact_data: "Datos de contacto",
      reported: "Reportados",
    },
  }),
  def("sanctionsEndingToday", {
    title: "Sanciones que vencen hoy",
    icon: "ShieldAlert",
    href: "/users",
    cta: "Abrir usuarios",
    sub: () => "se levantan solas a las 23:59",
    chips: { suspension: "Suspensión" },
  }),
]

export interface InboxChip {
  label: string
  count: number
}

/** Las dos primeras del desglose y el resto como "Otros" (o las tres si son tres). */
export function inboxChips(
  def: InboxDef,
  breakdown: OverviewInbox["breakdown"]
): InboxChip[] {
  const named = breakdown.map((b) => ({
    label: def.chips[b.key] ?? b.key,
    count: b.count,
  }))
  if (named.length <= 3) return named
  const rest = named.slice(2).reduce((a, b) => a + b.count, 0)
  return [...named.slice(0, 2), { label: "Otros", count: rest }]
}

export type OverviewBlocks = AdminOverview["blocks"]

const OLDEST_NAME: Record<AdminOverviewBlockName, string> = {
  disputes: "una disputa",
  support: "una conversación",
  kyc: "KYC",
  userReports: "un reporte",
  shipmentAlerts: "un envío con alerta",
  payments: "un pago",
  flaggedMessages: "un mensaje señalado",
  sanctionsEndingToday: "una sanción",
}

/** "Hay 60 cosas para atender en 7 bandejas. La más vieja: KYC de hace 26 h. 1 bandeja no cargó." */
export function overviewSummary(
  blocks: OverviewBlocks,
  loading: Set<AdminOverviewBlockName>,
  now: Date
): string {
  const states = INBOXES.map((d) => ({ d, b: blocks[d.id] }))
  if (loading.size === INBOXES.length) return "Cargando las bandejas…"
  const ok = states.filter((s) => !loading.has(s.d.id) && s.b?.data)
  const failed = states.filter((s) => !loading.has(s.d.id) && !s.b?.data).length
  const total = ok.reduce((a, s) => a + (s.b?.data?.count ?? 0), 0)
  const oldest = ok
    .filter(
      (s) =>
        s.b?.data?.oldestAt && s.b.data.count > 0 && s.b.data.slaHours != null
    )
    .sort((a, b) => a.b!.data!.oldestAt!.localeCompare(b.b!.data!.oldestAt!))[0]
  const parts = [
    total === 0
      ? "No hay nada pendiente."
      : `Hay ${total} ${total === 1 ? "cosa" : "cosas"} para atender en ${plural(ok.filter((s) => s.b!.data!.count > 0).length, "bandeja", "bandejas")}.`,
  ]
  if (oldest && total > 0)
    parts.push(
      `La más vieja: ${OLDEST_NAME[oldest.d.id]} de hace ${ageShort(oldest.b!.data!.oldestAt, now)}.`
    )
  if (failed)
    parts.push(
      failed === 1 ? "1 bandeja no cargó." : `${failed} bandejas no cargaron.`
    )
  return parts.join(" ")
}
