import type {
  AdminAccountStatus,
  AdminKycStatus,
  AdminLedgerStatus,
  AdminLedgerType,
  AdminReportReason,
  AdminReportStatus,
  AdminShipmentStatus,
  AdminTripStatus,
  AdminUserRoleName,
} from "@movo/shared/src/types/admin-users"

/** Tono de una pill de estado; se resuelve a los tokens semánticos de `globals.css`. */
export type Tone = "success" | "warning" | "danger" | "info" | "neutral"

export interface Pill {
  label: string
  tone: Tone
}

const TZ = "America/Argentina/Cordoba"
const dateFormat = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TZ,
})
const dayFormat = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  timeZone: TZ,
})
const dateTimeFormat = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
})

// `Intl` en es-AR devuelve "19 oct 2026" (con punto en algunos runtimes): se normaliza.
const clean = (value: string) =>
  value.replace(/\./g, "").replace(/\s+de\s+/g, " ")

/** `birthdate` viene como `YYYY-MM-DD`: se ancla a mediodía UTC para que el huso no corra el día. */
const parse = (iso: string) =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso)

export function formatDate(iso: string | null | undefined): string {
  return iso ? clean(dateFormat.format(parse(iso))) : "—"
}

export function formatDay(iso: string): string {
  return clean(dayFormat.format(parse(iso)))
}

export function formatDateTime(iso: string): string {
  return clean(dateTimeFormat.format(parse(iso)))
}

export function ageFrom(birthdate: string, now = new Date()): number {
  return Math.floor(
    (now.getTime() - parse(birthdate).getTime()) / (365.25 * 86_400_000)
  )
}

/** Días que faltan hasta `iso` (0 si ya pasó). */
export function daysUntil(iso: string, now = new Date()): number {
  return Math.max(
    0,
    Math.ceil((parse(iso).getTime() - now.getTime()) / 86_400_000)
  )
}

export function formatArs(amount: number): string {
  return `$${Math.abs(amount).toLocaleString("es-AR")}`
}

/** Monto con signo explícito para la cuenta corriente: `+$1.240`, `−$300`. */
export function formatSignedArs(amount: number): string {
  return `${amount > 0 ? "+" : "−"}${formatArs(amount)}`
}

export function formatRating(value: number): string {
  return value.toFixed(1).replace(".", ",")
}

export const shortId = (id: string) => id.slice(0, 8).toUpperCase()

export const ROLE_LABEL: Record<AdminUserRoleName, string> = {
  sender: "Emisor",
  carrier: "Transportista",
  admin: "Admin",
}

export const KYC: Record<AdminKycStatus, Pill> = {
  approved: { label: "Aprobado", tone: "success" },
  pending: { label: "Pendiente", tone: "info" },
  manual_review: { label: "Revisión manual", tone: "warning" },
  rejected: { label: "Rechazado", tone: "danger" },
  expired: { label: "Vencido", tone: "warning" },
  not_started: { label: "Sin iniciar", tone: "neutral" },
}

export function accountPill(
  status: AdminAccountStatus,
  bannedUntil: string | null,
  short = false
): Pill {
  if (status === "active") return { label: "Activa", tone: "success" }
  if (status === "deleted") return { label: "Eliminada", tone: "neutral" }
  if (bannedUntil)
    return {
      label: `${short ? "Suspendida · hasta" : "Suspendida hasta el"} ${formatDay(bannedUntil)}`,
      tone: "warning",
    }
  return { label: "Baneada", tone: "danger" }
}

export const SHIPMENT_STATUS: Record<AdminShipmentStatus, Pill> = {
  awaiting_receiver_confirmation: {
    label: "Esperando receptor",
    tone: "warning",
  },
  rejected_by_receiver: { label: "Rechazado", tone: "warning" },
  published: { label: "Publicado", tone: "neutral" },
  assignment_pending: { label: "Reservando pago", tone: "info" },
  assigned_unfunded: { label: "Fondos pendientes", tone: "warning" },
  assigned: { label: "Asignado", tone: "info" },
  in_transit: { label: "En camino", tone: "info" },
  delivered: { label: "Entregado", tone: "success" },
  completed: { label: "Completado", tone: "success" },
  cancelled: { label: "Cancelado", tone: "danger" },
  disputed: { label: "En disputa", tone: "warning" },
}

export const TRIP_STATUS: Record<AdminTripStatus, Pill> = {
  declared: { label: "Declarado", tone: "neutral" },
  active: { label: "En curso", tone: "info" },
  completed: { label: "Completado", tone: "success" },
  cancelled: { label: "Cancelado", tone: "danger" },
  expired: { label: "Vencido", tone: "warning" },
}

export const REPORT_REASON: Record<AdminReportReason, string> = {
  harassment: "Acoso o trato agresivo",
  no_show: "No se presentó",
  damaged_package: "Paquete dañado",
  payment_issue: "Problema con el pago",
  other: "Otro motivo",
}

export const REPORT_STATUS: Record<AdminReportStatus, Pill> = {
  pending: { label: "Pendiente", tone: "warning" },
  reviewed: { label: "Revisado", tone: "info" },
  dismissed: { label: "Descartado", tone: "neutral" },
}

export const LEDGER_TYPE: Record<AdminLedgerType, string> = {
  cancellation_penalty: "Penalidad por cancelación",
  penalty_capture: "Cobro de penalidad",
  cash_commission: "Comisión de envío en efectivo",
  fee_offset: "Descuento de comisión",
  payment_surcharge: "Recargo en un pago",
  voluntary_payment: "Pago de saldo",
  manual_adjustment: "Ajuste manual",
}

export const LEDGER_STATUS: Record<AdminLedgerStatus, Pill> = {
  pending: { label: "Pendiente", tone: "warning" },
  reserved: { label: "Reservado", tone: "info" },
  settled: { label: "Saldado", tone: "success" },
  voided: { label: "Anulado", tone: "neutral" },
}

export const AUDIT_OUTCOME: Record<"succeeded" | "failed" | "unknown", Pill> = {
  succeeded: { label: "Aplicada", tone: "success" },
  failed: { label: "Rechazada", tone: "danger" },
  unknown: { label: "Sin confirmar", tone: "warning" },
}

/** `+5493516124410` → `+54 9 351 612-4410`. Si no tiene la forma esperada, se muestra tal cual. */
export function formatPhone(e164: string): string {
  const m = /^\+549(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return m ? `+54 9 ${m[1]} ${m[2]}-${m[3]}` : e164
}

/** `33812405` → `33.812.405`. */
export function formatDni(dni: string | null): string {
  if (!dni) return "—"
  return /^\d{7,8}$/.test(dni) ? dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : dni
}
