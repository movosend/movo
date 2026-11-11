import "server-only"
import { ApiError } from "@movo/shared/src/errors/api-error"
import type {
  AdminTargetType,
  AuditLogEntry,
  AuditOutcome,
} from "@movo/shared/src/types/admin"
import {
  ADMIN_OVERVIEW_BLOCKS,
  DISTANCE_BANDS,
  auditTargetKey,
  reportAppliesBand,
  type AdminAuditAction,
  type AdminAuditLogPage,
  type AdminOverview,
  type AdminOverviewBlockName,
  type AdminReportById,
  type AdminReportId,
  type AdminReportQuery,
  type AuditTargetRef,
  type CaptureLeakage,
  type DistanceBand,
  type GmvBridge,
  type PriceComponent,
  type Report,
  type ReportBreakdown,
  type ReportCorridor,
  type ReportScorecardRow,
  type ReportValue,
} from "@movo/shared/src/types/admin-reports"
import { latency, mockEnabled, shouldFail, sleep } from "@/lib/shipments/mock"
import { argentinaDay } from "@/lib/shipments/format"
import { AUDIT_ACTION } from "./audit-catalog"
import type { AdminOverviewData } from "./overview"
import { REPORT_TABS, SCORECARD_COLUMNS } from "./catalog"
import { csvLine, demoFileName, reportFileName, reportSectionCsv } from "./csv"
import {
  MOCK_ADMINS,
  MOCK_CITIES,
  MOCK_CORRIDORS,
  MOCK_DIMENSIONS,
  MOCK_DISPUTE_TARGETS,
  MOCK_ERRORS,
  MOCK_METRICS,
  MOCK_REASONS,
  MOCK_SHIPMENT_IDS,
  MOCK_SUPPORT_TARGETS,
  MOCK_USERS,
  bandOfKm,
  type MockMetric,
} from "./fixtures"
import {
  bucketsOf,
  daysOf,
  diffDays,
  granularityOf,
  previousRange,
} from "./range"

export { mockEnabled }

/**
 * Modo fixtures de Inicio, Métricas y Bitácora (`MOVO_ADMIN_MOCK=1`, nunca en producción), mismo
 * criterio que el resto del panel: reemplaza solo `lib/reports/api.ts`. Reproduce el contrato de
 * `admin-reports.ts` (MOVO-342/344). `MOVO_ADMIN_MOCK_FAIL`:
 *   overview.<bloque> (p. ej. overview.userReports) · report · export · audit
 * fallan con 502 la primera vez; con `!` final, siempre.
 */

const unavailable = () =>
  new ApiError(502, "INTERNAL_ERROR", "El servicio no respondió.")
const today = () => argentinaDay(new Date())

// ---------------------------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------------------------

const hash = (s: string) =>
  [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const rnd = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return x - Math.floor(x)
}
const seedOf = (id: string) => (hash(id) % 1000) / 10
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()

interface Gen extends MockMetric {
  seed: number
}

/** Métricas que se repiten entre pestañas: salen del mismo generador, así coinciden. */
const SAME_AS: Record<string, [AdminReportId, string]> = {
  "pricing.completed": ["cashflow", "completed"],
  "pricing.avgTicket": ["cashflow", "avgTicket"],
  "operations.published": ["distances", "published"],
  "operations.completed": ["cashflow", "completed"],
}

function gen(report: AdminReportId, key: string): Gen {
  const [r, k] = SAME_AS[`${report}.${key}`] ?? [report, key]
  return { ...MOCK_METRICS[r][k], seed: seedOf(`${r}.${k}`) }
}

/** Valor de un día (offset desde hoy) sin filtros. */
function baseVal(m: Gen, day: string, d: number) {
  const w = weekday(day)
  const weekly = m.agg === "sum" ? (w === 0 ? 0.74 : w === 6 ? 0.86 : 1) : 1
  const trend = Math.max(0.15, 1 + (m.trend * d) / 90)
  const wave = 1 + 0.07 * Math.sin((d + m.seed) / 4.3)
  const noise =
    m.agg === "sum" ? 0.84 + 0.32 * rnd(m.seed, d) : 0.95 + 0.1 * rnd(m.seed, d)
  return m.base * trend * weekly * wave * noise
}

/** Los envíos largos ganan participación con el tiempo: el mix se mueve entre períodos. */
const BAND_DRIFT = [-0.12, 0.08, 0.4]

function shareOf(m: Gen, dim: string, i: number, d: number) {
  const w = MOCK_DIMENSIONS[dim].map(
    ([, n], j) =>
      n *
      (1 + 0.14 * Math.sin(d / 5 + j * 1.7 + m.seed)) *
      (dim === "band" ? Math.max(0.2, 1 - (BAND_DRIFT[j] * d) / 90) : 1)
  )
  return w[i] / w.reduce((a, b) => a + b, 0)
}

const bandIndex = (band: DistanceBand) => DISTANCE_BANDS.indexOf(band)

function val(
  m: Gen,
  day: string,
  d: number,
  band: DistanceBand | null,
  seg: { dim: string; i: number } | null
) {
  let v = baseVal(m, day, d)
  if (band) {
    const i = bandIndex(band)
    v *=
      m.agg === "sum"
        ? shareOf(m, "band", i, d)
        : (m.bandF?.[i] ?? 1) * (1 + 0.03 * Math.sin(d / 7 + i))
  }
  if (seg)
    v *=
      m.agg === "sum"
        ? shareOf(m, seg.dim, seg.i, d)
        : 0.7 + 0.6 * rnd(m.seed + (hash(seg.dim) % 97), seg.i)
  return m.pct ? Math.min(v, 100) : v
}

function roundFor(m: Gen, v: number) {
  if (m.agg === "sum" || !m.pct)
    return v >= 100 ? Math.round(v) : Math.round(v * 10) / 10
  return Math.round(v * 10) / 10
}

function aggregate(
  m: Gen,
  days: string[],
  todayIso: string,
  band: DistanceBand | null,
  seg: { dim: string; i: number } | null = null
) {
  if (!days.length) return null
  const vs = days.map((day) => {
    const d = diffDays(todayIso, day)
    const v = val(m, day, d, band, seg)
    // Lo que suma son conteos enteros por día: con 0,35 disputas diarias, redondear cada día da
    // todo cero. Se redondea con un umbral determinista, así hay días con 1 y días con 0.
    return m.agg === "sum" ? Math.floor(v + rnd(m.seed + 3, d)) : v
  })
  const s = vs.reduce((a, b) => a + b, 0)
  const total = m.agg === "sum" ? s : s / vs.length
  return m.agg === "sum" ? Math.round(total) : roundFor(m, total)
}

function buildReport(
  id: AdminReportId,
  query: AdminReportQuery
): AdminReportById[AdminReportId] {
  const t = today()
  const range = { from: query.from, to: query.to }
  const prev = previousRange(range)
  const len = diffDays(range.from, range.to) + 1
  const granularity = granularityOf(range)
  const bandApplied = reportAppliesBand(id)
  const band = bandApplied ? (query.band ?? null) : null
  const shift = (day: string) => {
    const date = new Date(`${day}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() - len)
    return date.toISOString().slice(0, 10)
  }
  const days = daysOf(range)
  const prevDays = days.map(shift)
  const keys = Object.keys(MOCK_METRICS[id])
  const value = (
    key: string,
    b = band,
    seg: { dim: string; i: number } | null = null
  ): ReportValue => {
    const m = gen(id, key)
    return {
      value: aggregate(m, days, t, b, seg),
      previous: aggregate(m, prevDays, t, b, seg),
    }
  }
  const kpis = Object.fromEntries(keys.map((k) => [k, value(k)]))
  const buckets = bucketsOf(range, granularity)
  const series = Object.fromEntries(
    keys.map((k) => {
      const m = gen(id, k)
      return [
        k,
        buckets.map((b) => {
          const bd = daysOf({ from: b.start, to: b.end })
          return {
            start: b.start,
            end: b.end,
            value: aggregate(m, bd, t, band),
            previous: aggregate(m, bd.map(shift), t, band),
          }
        }),
      ]
    })
  )
  const tab = REPORT_TABS.find((x) => x.id === id)!
  const breakdowns: ReportBreakdown[] = tab.breakdowns.map((p) => {
    const m = gen(id, p.metric)
    const isBand = p.dimension === "band"
    const sums = m.agg === "sum"
    let rows = MOCK_DIMENSIONS[p.dimension].map(([key], i) => {
      const v = isBand
        ? value(p.metric, key as DistanceBand)
        : value(p.metric, band, { dim: p.dimension, i })
      const extra = p.extra
        ? {
            [p.extra.key]: (isBand
              ? value(p.extra.key, key as DistanceBand)
              : value(p.extra.key)
            ).value,
          }
        : undefined
      return {
        key,
        ...v,
        share: null as number | null,
        ...(extra ? { extra } : {}),
      }
    })
    if (!isBand) rows = rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    const sum = (k: "value" | "previous") =>
      rows.reduce((a, r) => a + (r[k] ?? 0), 0)
    const total = sums
      ? { value: sum("value"), previous: sum("previous") }
      : value(p.metric)
    if (sums && total.value)
      rows = rows.map((r) => ({
        ...r,
        share: Math.round(((r.value ?? 0) / total.value!) * 1000) / 10,
      }))
    return { dimension: p.dimension, metric: p.metric, total, rows }
  })
  const meta = {
    range,
    previous: prev,
    granularity,
    band,
    bandApplied,
    generatedAt: new Date().toISOString(),
  }
  const base: Report<string> = { meta, kpis, series, breakdowns }

  // GMV = envíos × ticket: el ticket es el cociente, no una serie aparte.
  let gmv: ReportValue | null = null
  if (id === "cashflow" || id === "pricing") {
    const g = gen("cashflow", "gmv")
    const q = gen("cashflow", "completed")
    const ratio = (ds: string[]) => {
      const a = aggregate(g, ds, t, band)
      const b = aggregate(q, ds, t, band)
      return a != null && b ? Math.round(a / b) : null
    }
    gmv = {
      value: aggregate(g, days, t, band),
      previous: aggregate(g, prevDays, t, band),
    }
    base.kpis.avgTicket = { value: ratio(days), previous: ratio(prevDays) }
    base.series.avgTicket = buckets.map((b) => {
      const bd = daysOf({ from: b.start, to: b.end })
      return {
        start: b.start,
        end: b.end,
        value: ratio(bd),
        previous: ratio(bd.map(shift)),
      }
    })
  }

  if (id === "pricing") {
    const bridge = mockBridge(gmv!, base.kpis.completed, len)
    if (bridge) {
      const price = bridge.price.reduce((a, p) => a + p.amount, 0)
      base.kpis.priceIndex = {
        value:
          Math.round((1000 * bridge.current) / (bridge.current - price)) / 10,
        previous: 100,
      }
    }
    const takeRate = aggregate(gen("cashflow", "takeRate"), days, t, band)
    return {
      ...base,
      bridge,
      leakage: mockLeakage(
        gmv!.value,
        base.kpis.captureRate.value,
        takeRate,
        base.kpis.completed.value
      ),
    } as AdminReportById["pricing"]
  }

  if (id === "carriers") {
    const pub = gen("distances", "published")
    const rate = gen("carriers", "assignedWithin24hRate")
    return {
      ...base,
      supply: buckets.map((b) => {
        const bd = daysOf({ from: b.start, to: b.end })
        const published = aggregate(pub, bd, t, band)
        const r = aggregate(rate, bd, t, band)
        return {
          start: b.start,
          end: b.end,
          published,
          assignedWithin24h:
            published != null && r != null
              ? Math.round((published * r) / 100)
              : null,
        }
      }),
    } as AdminReportById["carriers"]
  }

  if (id === "disputes") {
    const cohort = (n: number | null, maturity: number) => {
      if (!n) return null
      // Una cohorte reciente todavía no terminó: decide y resuelve menos.
      const decided = Math.round(n * 0.86 * maturity)
      return { opened: n, decided, resolved: Math.round(decided * 0.8) }
    }
    const now = cohort(base.kpis.opened.value, len <= 7 ? 0.7 : 0.94)
    const before = cohort(base.kpis.opened.previous, 1)
    return {
      ...base,
      funnel: now && [
        {
          key: "opened",
          count: now.opened,
          previous: before?.opened ?? null,
          medianHoursFromPrevious: null,
        },
        {
          key: "decided",
          count: now.decided,
          previous: before?.decided ?? null,
          medianHoursFromPrevious: 26.5,
        },
        {
          key: "resolved",
          count: now.resolved,
          previous: before?.resolved ?? null,
          medianHoursFromPrevious: 7.2,
        },
      ],
    } as AdminReportById["disputes"]
  }

  if (id === "cashflow")
    return {
      ...base,
      pendingCapture: { count: 3, amountArs: 41500 },
    } as AdminReportById["cashflow"]
  if (id === "operations") {
    // La ciudad solo recorta su desglose: los números de demostración no se filtran de verdad.
    const city = query.city ?? null
    const byCity = base.breakdowns.find((b) => b.dimension === "city")
    const cities = (byCity?.rows ?? [])
      .filter((r) => !r.key.startsWith("__"))
      .map((r) => ({ city: r.key, published: r.value ?? 0 }))
    return {
      ...base,
      breakdowns: base.breakdowns.map((b) =>
        b.dimension === "city" && city
          ? { ...b, rows: b.rows.filter((r) => r.key === city) }
          : b
      ),
      city,
      cities,
    } as AdminReportById["operations"]
  }
  if (id === "finance")
    return {
      ...base,
      pendingConfirmation: { count: 4, amountArs: 52300 },
      escalated: { count: 1, amountArs: 18700 },
      debt: { debtorUsers: 37, creditUsers: 5, creditArs: 6200 },
    } as AdminReportById["finance"]
  if (id === "distances") {
    const pub = gen("distances", "published")
    const comp = gen("distances", "completionRate")
    const bandTotals = DISTANCE_BANDS.map((b) => ({
      cur: aggregate(pub, days, t, b) ?? 0,
      prev: aggregate(pub, prevDays, t, b) ?? 0,
      comp: aggregate(comp, days, t, b) ?? 0,
    }))
    const weights = DISTANCE_BANDS.map((b) =>
      MOCK_CORRIDORS.filter((c) => bandOfKm(c[2]) === b).reduce(
        (a, c) => a + c[3],
        0
      )
    )
    const corridors: ReportCorridor[] = MOCK_CORRIDORS.map(
      ([a, b, km, w, adj]) => {
        const bi = bandIndex(bandOfKm(km))
        return {
          originCity: a,
          destinationCity: b,
          originLat: MOCK_CITIES[a][0],
          originLng: MOCK_CITIES[a][1],
          destinationLat: MOCK_CITIES[b][0],
          destinationLng: MOCK_CITIES[b][1],
          distanceKm: km,
          band: bandOfKm(km),
          published: Math.round((bandTotals[bi].cur * w) / weights[bi]),
          publishedPrevious: Math.round(
            (bandTotals[bi].prev * w) / weights[bi]
          ),
          completionRate: Math.min(
            99,
            Math.max(70, Math.round(bandTotals[bi].comp + adj))
          ),
        }
      }
    )
      .filter((c) => !band || c.band === band)
      .sort((x, y) => y.published - x.published)
      .slice(0, 20)
    const scorecard: ReportScorecardRow[] = DISTANCE_BANDS.map((b) => {
      const cell = (k: string): ReportValue => {
        const [report, key] = (
          {
            published: ["distances", "published"],
            completionRate: ["distances", "completionRate"],
            onTimeRate: ["deliveries", "onTimeRate"],
            assignedWithin24hRate: ["carriers", "assignedWithin24hRate"],
            doorToDoorHours: ["deliveries", "doorToDoorHours"],
            avgTicket: ["cashflow", "avgTicket"],
          } as Record<string, [AdminReportId, string]>
        )[k]
        const m = gen(report, key)
        return {
          value: aggregate(m, days, t, b),
          previous: aggregate(m, prevDays, t, b),
        }
      }
      return Object.fromEntries([
        ["band", b],
        ...SCORECARD_COLUMNS.map((c) => [c.key, cell(c.key)]),
      ]) as unknown as ReportScorecardRow
    })
    return { ...base, corridors, scorecard } as AdminReportById["distances"]
  }
  return base as AdminReportById[AdminReportId]
}

/** Reparto del cambio que no es volumen entre mix y componentes del precio (con signos mezclados). */
function mockBridge(
  gmv: ReportValue,
  completed: ReportValue,
  len: number
): GmvBridge | null {
  const [g0, g1, q0, q1] = [
    gmv.previous,
    gmv.value,
    completed.previous,
    completed.value,
  ]
  if (g0 == null || g1 == null || !q0 || !q1) return null
  const volume = Math.round((q1 - q0) * (g0 / q0))
  const rest = g1 - g0 - volume
  const swing = Math.sin(len / 3)
  const raw: [string, number][] = [
    ["mix", 0.24],
    ["fuel", 0.5],
    ["demand", 0.22 * swing],
    ["distance", 0.07],
    ["package", 0.05],
    ["algorithm", 0],
    ["negotiation", -0.12],
  ]
  // Repartido sobre el 97 %: "otros" queda chico, como debería.
  const sum = raw.reduce((a, [, w]) => a + w, 0)
  const weights = raw.map(([k, w]) => [k, (w / sum) * 0.97] as const)
  const scale = rest
  const parts = weights.map(([k, w]) => [k, Math.round(scale * w)] as const)
  const assigned = parts.reduce((a, [, v]) => a + v, 0)
  const byKey = Object.fromEntries(parts)
  return {
    previous: g0,
    current: g1,
    volume,
    mix: byKey.mix,
    price: [
      ...(
        [
          "fuel",
          "demand",
          "distance",
          "package",
          "algorithm",
          "negotiation",
        ] as PriceComponent[]
      ).map((key) => ({ key, amount: byKey[key] })),
      { key: "other", amount: rest - assigned },
    ],
  }
}

const LEAK_WEIGHTS: [
  CaptureLeakage["steps"][number]["key"],
  number,
  boolean,
][] = [
  ["unassigned", 0.29, false],
  ["cancelled", 0.22, false],
  ["payment_failed", 0.09, false],
  ["hold_expired", 0.05, false],
  ["capture_failed", 0.03, false],
  ["dispute_refund", 0.07, false],
  ["pending_capture", 0.08, true],
  ["in_flight", 0.17, true],
]

/** Cotizado de lo publicado → capturado, cerrando exacto en GMV y en comisión. */
function mockLeakage(
  gmv: number | null,
  captureRate: number | null,
  takeRate: number | null,
  completed: number | null
): CaptureLeakage | null {
  if (!gmv || !captureRate || !completed) return null
  const tr = (takeRate ?? 12) / 100
  const ticket = gmv / completed
  const captured = Math.round(gmv * 0.96)
  const quoted = Math.round(captured / (captureRate / 100))
  const gap = quoted - captured
  let left = gap
  const steps: CaptureLeakage["steps"] = LEAK_WEIGHTS.map(
    ([key, w, timing], i) => {
      const amount = i === LEAK_WEIGHTS.length - 1 ? left : Math.round(gap * w)
      left -= amount
      return {
        key,
        timing,
        shipments: Math.max(1, Math.round(amount / ticket)),
        gmvArs: amount,
        commissionArs: Math.round(amount * tr),
      }
    }
  )
  const quotedCommission = Math.round(quoted * tr)
  const cash = Math.round(quotedCommission * 0.018)
  steps.splice(6, 0, {
    key: "cash_commission_debt",
    timing: false,
    shipments: Math.max(1, Math.round(cash / (ticket * tr))),
    gmvArs: 0,
    commissionArs: cash,
  })
  const quotedShipments = Math.round(quoted / ticket)
  const lostShipments = steps
    .filter((s) => s.gmvArs > 0)
    .reduce((a, s) => a + s.shipments, 0)
  return {
    quoted: {
      shipments: quotedShipments,
      gmvArs: quoted,
      commissionArs: quotedCommission,
    },
    steps,
    captured: {
      shipments: quotedShipments - lostShipments,
      gmvArs: captured,
      commissionArs:
        quotedCommission - steps.reduce((a, s) => a + s.commissionArs, 0),
    },
  }
}

export async function mockGetReport<R extends AdminReportId>(
  id: R,
  query: AdminReportQuery
): Promise<AdminReportById[R]> {
  await sleep(latency())
  if (shouldFail("report")) throw unavailable()
  return buildReport(id, query) as AdminReportById[R]
}

export async function mockExportReport(
  id: AdminReportId,
  query: AdminReportQuery,
  section: string
) {
  await sleep(latency() * 2)
  if (shouldFail("export")) throw unavailable()
  return exportOf(id, query, section)
}

function exportOf(
  id: AdminReportId,
  query: AdminReportQuery,
  section: string,
  demo = false
) {
  const report = buildReport(id, query)
  const { csv, rows } = reportSectionCsv(id, report, section)
  const name = reportFileName(id, section, report.meta.range, report.meta.band)
  return {
    csv,
    rows,
    truncated: false,
    filename: demo ? demoFileName(name) : name,
  }
}

/**
 * Modo demostración de Métricas (`datos=demo`): los mismos generadores que el modo fixtures, pero
 * también en producción y sin latencia ni fallas simuladas. Solo Métricas: no toca el resto del panel.
 */
export const demoReport = <R extends AdminReportId>(
  id: R,
  query: AdminReportQuery
): AdminReportById[R] => buildReport(id, query) as AdminReportById[R]

export const demoExportReport = (
  id: AdminReportId,
  query: AdminReportQuery,
  section: string
) => exportOf(id, query, section, true)

// ---------------------------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------------------------

const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString()

function overviewData(): AdminOverviewData {
  return {
    disputes: {
      count: 7,
      awaitingPayment: 2,
      oldestAt: ago(72 * 60 + 40),
      slaHours: 72,
      overSla: true,
      yesterdayCount: 5,
      breakdown: [
        { key: "damaged", count: 3 },
        { key: "not_delivered", count: 2 },
        { key: "transit_anomaly", count: 1 },
        { key: "other", count: 1 },
      ],
    },
    support: {
      count: 12,
      urgent: 3,
      oldestAt: ago(14),
      slaHours: 0.5,
      overSla: false,
      yesterdayCount: null,
      breakdown: [
        { key: "shipment", count: 6 },
        { key: "payments", count: 3 },
        { key: "account", count: 3 },
      ],
    },
    kyc: {
      count: 18,
      carriers: 11,
      senders: 7,
      oldestAt: ago(26 * 60),
      slaHours: 24,
      overSla: true,
      yesterdayCount: 13,
      breakdown: [
        { key: "selfie_doubtful", count: 4 },
        { key: "document_expired", count: 2 },
      ],
    },
    userReports: {
      count: 5,
      blockRequested: 1,
      oldestAt: ago(9 * 60),
      slaHours: 24,
      overSla: false,
      yesterdayCount: null,
      breakdown: [
        { key: "inappropriate_behavior", count: 3 },
        { key: "no_show", count: 2 },
      ],
    },
    shipmentAlerts: {
      count: 4,
      inTransit: 4,
      oldestAt: ago(38),
      slaHours: 1,
      overSla: false,
      yesterdayCount: null,
      breakdown: [
        { key: "signal_lost", count: 2 },
        { key: "pickup_delayed", count: 2 },
      ],
    },
    payments: {
      count: 3,
      holdsExpiringToday: 1,
      oldestAt: ago(5 * 60),
      slaHours: 6,
      overSla: false,
      yesterdayCount: 4,
      breakdown: [
        { key: "dispute_resolving", count: 2 },
        { key: "capture_failed", count: 1 },
      ],
    },
    flaggedMessages: {
      count: 9,
      oldestAt: ago(2 * 60),
      slaHours: 12,
      overSla: false,
      yesterdayCount: 6,
      breakdown: [
        { key: "insults", count: 6 },
        { key: "contact_data", count: 3 },
      ],
    },
    sanctionsEndingToday: {
      count: 2,
      oldestAt: ago(7 * 24 * 60),
      slaHours: null,
      overSla: false,
      yesterdayCount: 2,
      breakdown: [{ key: "suspension", count: 2 }],
    },
  }
}

const SERVICE_OF: Record<AdminOverviewBlockName, string> = {
  disputes: "svc-shipments",
  support: "svc-shipments",
  kyc: "svc-users",
  userReports: "svc-users",
  shipmentAlerts: "svc-shipments",
  payments: "svc-payments",
  flaggedMessages: "svc-shipments",
  sanctionsEndingToday: "svc-users",
}

export async function mockGetOverview(
  blocks?: AdminOverviewBlockName[]
): Promise<AdminOverview> {
  await sleep(latency())
  const data = overviewData()
  const wanted = blocks?.length ? blocks : ADMIN_OVERVIEW_BLOCKS
  const out: Record<string, unknown> = {}
  for (const id of wanted) {
    out[id] = shouldFail(`overview.${id}`)
      ? {
          data: null,
          error: {
            code: "UPSTREAM_TIMEOUT",
            message: `${SERVICE_OF[id]} tardó más de 5 s en responder.`,
            requestId: `req_${(hash(id + Date.now()) >>> 0).toString(16).slice(0, 8)}`,
          },
        }
      : { data: data[id], error: null }
  }
  return {
    generatedAt: new Date().toISOString(),
    blocks: out as AdminOverview["blocks"],
  }
}

// ---------------------------------------------------------------------------------------------
// Bitácora
// ---------------------------------------------------------------------------------------------

interface MockAuditRow extends AuditLogEntry {
  target: AuditTargetRef
}

function targetFor(
  type: AdminTargetType,
  i: number
): { id: string; ref: AuditTargetRef } {
  const r = rnd(i, 7)
  switch (type) {
    case "user": {
      const [id, name] = MOCK_USERS[Math.floor(r * MOCK_USERS.length)]
      return { id, ref: { label: name } }
    }
    case "shipment":
      return {
        id: MOCK_SHIPMENT_IDS[Math.floor(r * MOCK_SHIPMENT_IDS.length)],
        ref: { label: null },
      }
    case "dispute": {
      const [id, shipmentId] =
        MOCK_DISPUTE_TARGETS[Math.floor(r * MOCK_DISPUTE_TARGETS.length)]
      return { id, ref: { label: null, shipmentId } }
    }
    case "support_conversation": {
      const [id, code] =
        MOCK_SUPPORT_TARGETS[Math.floor(r * MOCK_SUPPORT_TARGETS.length)]
      return { id, ref: { label: code } }
    }
    default: {
      const email = ["lucia.paz@movosend.app", "diego.arce@movosend.app"][
        Math.floor(r * 2)
      ]
      return { id: email, ref: { label: email } }
    }
  }
}

function contextFor(action: string, i: number): Record<string, unknown> | null {
  const amount = 3000 + Math.round(rnd(i, 9) * 8) * 500
  switch (action) {
    case "dispute.resolve": {
      const o = (["partial", "carrier", "sender"] as const)[i % 3]
      if (o === "partial")
        return {
          outcome: o,
          percentage: 50,
          paymentAction: "capture_partial",
          carrierAmountArs: amount / 2,
          senderAmountArs: amount / 2,
        }
      if (o === "carrier")
        return {
          outcome: o,
          paymentAction: "capture_hold",
          carrierAmountArs: amount,
          senderAmountArs: 0,
        }
      return {
        outcome: o,
        paymentAction: "refund_full",
        carrierAmountArs: 0,
        senderAmountArs: amount,
      }
    }
    case "shipment.status_change":
      return { from: "in_transit", to: "delivered", kind: "forced" }
    case "user.suspend":
      return { durationDays: 7 }
    case "user.ledger_adjust":
      return { amountArs: -1200, entryKind: "manual" }
    case "user.contact_update":
      return { field: "phone" }
    case "support.attachment_request":
      return { contentType: "image/jpeg", sizeBytes: 482113 }
    default:
      return null
  }
}

let auditLog: MockAuditRow[] | null = null

const stripTarget = (row: MockAuditRow): AuditLogEntry => {
  const entry: Partial<MockAuditRow> = { ...row }
  delete entry.target
  return entry as AuditLogEntry
}

function buildAuditLog(): MockAuditRow[] {
  const actions = (Object.keys(AUDIT_ACTION) as AdminAuditAction[]).filter(
    (a) => a !== "report.export"
  )
  const out: MockAuditRow[] = []
  let t = Date.now() - 4 * 60_000
  for (let i = 0; i < 64; i++) {
    let action: AdminAuditAction =
      actions[Math.floor(rnd(i, 1) * actions.length)]
    if (i === 0) action = "support.attachment_request"
    if (i === 1) action = "dispute.note_add"
    if (i === 4) action = "shipment.status_change"
    if (i % 9 === 2) action = "dispute.resolve"
    const type = AUDIT_ACTION[action].target
    const { id, ref } = targetFor(type, i)
    const [adminId] = MOCK_ADMINS[Math.floor(rnd(i, 2) * MOCK_ADMINS.length)]
    let outcome: AuditOutcome = "succeeded"
    let errorCode: string | null = null
    if (i === 4) {
      outcome = "unknown"
      errorCode = "UPSTREAM_TIMEOUT"
    } else if (rnd(i, 5) < 0.08) {
      outcome = "failed"
      errorCode = MOCK_ERRORS[action] ?? "UPSTREAM_TIMEOUT"
    }
    const reasons = MOCK_REASONS[action]
    out.push({
      id: `aud_${90000 - i}`,
      adminId,
      action,
      targetType: type,
      targetId: id,
      reason: reasons ? reasons[i % reasons.length] : null,
      context: contextFor(action, i),
      outcome,
      errorCode,
      requestId: `req_${(hash(`r${i}`) >>> 0).toString(16).slice(0, 8)}`,
      createdAt: new Date(t).toISOString(),
      target: ref,
    })
    t -= (6 + rnd(i, 3) * 110) * 60_000
  }
  return out
}

const allAudit = () => (auditLog ??= buildAuditLog())

function filterAudit(query: URLSearchParams) {
  const adminId = query.get("adminId")
  const action = query.get("action")
  const type = query.get("targetType")
  const target = (query.get("targetId") ?? "").toLowerCase()
  return allAudit().filter(
    (e) =>
      (!adminId || e.adminId === adminId) &&
      (!action || e.action === action) &&
      (!type || e.targetType === type) &&
      (!target ||
        e.targetId.toLowerCase() === target ||
        (target.length >= 8 && e.targetId.toLowerCase().startsWith(target)))
  )
}

export async function mockAuditLog(
  query: URLSearchParams
): Promise<AdminAuditLogPage> {
  await sleep(latency())
  if (shouldFail("audit")) throw unavailable()
  const limit = Number(query.get("limit") ?? 20)
  const offset = Number(query.get("cursor") ?? 0) || 0
  const rows = filterAudit(query)
  const page = rows.slice(offset, offset + limit)
  return {
    items: page.map(stripTarget),
    nextCursor: offset + limit < rows.length ? String(offset + limit) : null,
    admins: Object.fromEntries(
      MOCK_ADMINS.map(([id, fullName]) => [id, { fullName }])
    ),
    targets: Object.fromEntries(
      page.map((e) => [auditTargetKey(e.targetType, e.targetId), e.target])
    ),
  }
}

export async function mockExportAuditLog(query: URLSearchParams) {
  await sleep(latency() * 2)
  if (shouldFail("export")) throw unavailable()
  const names = Object.fromEntries(MOCK_ADMINS)
  const rows = filterAudit(query)
  const head = [
    "created_at",
    "admin_id",
    "admin_name",
    "action",
    "target_type",
    "target_id",
    "outcome",
    "error_code",
    "reason",
    "request_id",
  ]
  const body = rows.map((e) =>
    csvLine([
      e.createdAt,
      e.adminId,
      names[e.adminId],
      e.action,
      e.targetType,
      e.targetId,
      e.outcome,
      e.errorCode,
      e.reason,
      e.requestId,
    ])
  )
  return {
    csv: `﻿${[head.join(","), ...body].join("\n")}\n`,
    rows: rows.length,
    truncated: false,
    filename: `movo-bitacora_${today()}.csv`,
  }
}
