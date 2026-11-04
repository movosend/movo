import {
  ADMIN_REPORT_IDS,
  DISTANCE_BANDS,
  type AdminReportId,
  type DistanceBand,
  type ReportRange,
} from "@movo/shared/src/types/admin-reports"
import type { AdminTargetType } from "@movo/shared/src/types/admin"
import { DEFAULT_TAB } from "./catalog"
import {
  DEFAULT_PRESET,
  isDay,
  RANGE_PRESETS,
  resolveRange,
  type RangePreset,
} from "./range"

type Raw = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? null

// ---------------------------------------------------------------------------------------------
// Métricas: `/metrics?tab=&r=&d=&desde=&hasta=&from=&datos=`
// ---------------------------------------------------------------------------------------------

export interface MetricsState {
  tab: AdminReportId
  preset: RangePreset
  /** Solo con `preset === "custom"`. */
  from: string | null
  to: string | null
  band: DistanceBand | null
  /** Disputa desde la que se llegó (resalta su motivo en el desglose). */
  dispute: string | null
  /**
   * Datos de demostración (`datos=demo`): el panel genera números ficticios en vez de pedirlos al
   * backend, para mostrarlo cuando la red real tiene pocos envíos. Siempre con aviso.
   */
  demo: boolean
}

export const EMPTY_METRICS_STATE: MetricsState = {
  tab: DEFAULT_TAB,
  preset: DEFAULT_PRESET,
  from: null,
  to: null,
  band: null,
  dispute: null,
  demo: false,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseMetricsState(raw: Raw): MetricsState {
  const tab = one(raw.tab)
  const preset = one(raw.r)
  const band = one(raw.d)
  const from = one(raw.desde)
  const to = one(raw.hasta)
  const dispute = one(raw.from)
  const custom = preset === "custom" && isDay(from) && isDay(to)
  return {
    tab: ADMIN_REPORT_IDS.includes(tab as AdminReportId)
      ? (tab as AdminReportId)
      : DEFAULT_TAB,
    preset: custom
      ? "custom"
      : RANGE_PRESETS.includes(preset as RangePreset) && preset !== "custom"
        ? (preset as RangePreset)
        : DEFAULT_PRESET,
    from: custom ? from : null,
    to: custom ? to : null,
    band: DISTANCE_BANDS.includes(band as DistanceBand)
      ? (band as DistanceBand)
      : null,
    dispute: dispute && UUID.test(dispute) ? dispute : null,
    demo: one(raw.datos) === "demo",
  }
}

export function metricsQuery(state: MetricsState): string {
  const q = new URLSearchParams()
  if (state.tab !== DEFAULT_TAB) q.set("tab", state.tab)
  if (state.preset !== DEFAULT_PRESET) q.set("r", state.preset)
  if (state.preset === "custom" && state.from && state.to) {
    q.set("desde", state.from)
    q.set("hasta", state.to)
  }
  if (state.band) q.set("d", state.band)
  if (state.dispute && state.tab === "disputes") q.set("from", state.dispute)
  if (state.demo) q.set("datos", "demo")
  return q.toString()
}

export const metricsHref = (state: MetricsState) => {
  const q = metricsQuery(state)
  return q ? `/metrics?${q}` : "/metrics"
}

export const metricsRange = (state: MetricsState, today: string): ReportRange =>
  resolveRange(state.preset, today, { from: state.from, to: state.to })

/** Link del expediente de una disputa al reporte de disputas de los últimos 90 días. */
export const disputeReportHref = (disputeId: string) =>
  metricsHref({
    ...EMPTY_METRICS_STATE,
    tab: "disputes",
    preset: "90d",
    dispute: disputeId,
  })

// ---------------------------------------------------------------------------------------------
// Bitácora: `/audit-log?admin=&action=&target=&q=&view=`
// ---------------------------------------------------------------------------------------------

export const AUDIT_TARGET_TYPES: readonly AdminTargetType[] = [
  "user",
  "admin_role",
  "shipment",
  "dispute",
  "support_conversation",
  "chat_report",
  "user_report",
]

export type AuditView = "table" | "timeline"

export interface AuditState {
  adminId: string | null
  action: string | null
  targetType: AdminTargetType | null
  /** Id del objetivo, exacto o prefijo desde 8 caracteres. */
  q: string
  view: AuditView
}

export const EMPTY_AUDIT_STATE: AuditState = {
  adminId: null,
  action: null,
  targetType: null,
  q: "",
  // La línea de tiempo es la vista por defecto; la tabla viaja como `view=table`.
  view: "timeline",
}

const ACTION_RE = /^[a-z_]+\.[a-z_]+$/

export function parseAuditState(raw: Raw): AuditState {
  const adminId = one(raw.admin)
  const action = one(raw.action)
  const target = one(raw.target)
  const q = (one(raw.q) ?? "").trim().slice(0, 254)
  return {
    adminId: adminId && UUID.test(adminId) ? adminId : null,
    action: action && ACTION_RE.test(action) ? action : null,
    targetType: AUDIT_TARGET_TYPES.includes(target as AdminTargetType)
      ? (target as AdminTargetType)
      : null,
    q,
    view: one(raw.view) === "table" ? "table" : "timeline",
  }
}

export function auditQuery(state: AuditState): string {
  const q = new URLSearchParams()
  if (state.adminId) q.set("admin", state.adminId)
  if (state.action) q.set("action", state.action)
  if (state.targetType) q.set("target", state.targetType)
  if (state.q) q.set("q", state.q)
  if (state.view === "table") q.set("view", "table")
  return q.toString()
}

/** Solo los filtros, sin la vista: la clave de la lista y la query del export. */
export const auditFilterQuery = (state: AuditState) =>
  auditQuery({ ...state, view: EMPTY_AUDIT_STATE.view })

export const auditHref = (state: AuditState) => {
  const q = auditQuery(state)
  return q ? `/audit-log?${q}` : "/audit-log"
}

/** Querystring hacia `svc-admin` (`GET /admin/audit-log[/export]`): sin la vista, con los nombres del contrato. */
export function auditGatewayQuery(
  state: AuditState,
  extra: { cursor?: string | null; limit?: number } = {}
): string {
  const q = new URLSearchParams()
  if (state.adminId) q.set("adminId", state.adminId)
  if (state.action) q.set("action", state.action)
  if (state.targetType) q.set("targetType", state.targetType)
  // `#MOVO-12345` o `#3F6C1A52`: se busca sin el numeral.
  const target = state.q.replace(/^#/, "").trim()
  if (target) q.set("targetId", target)
  if (extra.limit) q.set("limit", String(extra.limit))
  if (extra.cursor) q.set("cursor", extra.cursor)
  return q.toString()
}

export const hasAuditFilters = (state: AuditState) =>
  !!(state.adminId || state.action || state.targetType || state.q)
