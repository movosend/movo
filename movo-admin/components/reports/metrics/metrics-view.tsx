"use client"
import { useState } from "react"
import { Info } from "lucide-react"
import type {
  AdminReportById,
  AdminReportId,
  DistancesReport,
  CarriersReport,
  CashflowReport,
  DisputesReport,
  DistanceBand,
  FinanceReport,
  OperationsReport,
  PricingReport,
  Report,
  ReportBreakdown,
} from "@movo/shared/src/types/admin-reports"
import {
  bandLabelOf,
  dimensionKeyLabel,
  metricOf,
  tabOf,
  type BreakdownPanel,
} from "@/lib/reports/catalog"
import { demoFileName, reportFileName } from "@/lib/reports/csv"
import type { MetricsState } from "@/lib/reports/params"
import {
  deltaOf,
  formatMetric,
  GRANULARITY_LABEL,
  rangeLabel,
} from "@/lib/reports/format"
import { cn } from "@/lib/utils"
import { CsvButton } from "../csv-button"
import { DeltaChip, seriesColor, seriesInk, Sparkline } from "./chart-bits"
import { SupplyCard } from "./carriers"
import { CorridorMap, Scorecard } from "./distances"
import { DisputesFlow } from "./disputes-flow"
import { DebtSnapshot, FinanceNotices } from "./finance"
import { CityPicker } from "./operations"
import { BridgeCard, LeakageCard } from "./pricing"
import { TrendChart } from "./trend-chart"

export function MetricsView<R extends AdminReportId>({
  id,
  report,
  highlight,
  demo = false,
  state,
}: {
  id: R
  report: AdminReportById[R]
  /** Disputa de origen: su motivo se marca en "Por motivo". */
  highlight: string | null
  /** Datos de demostración: los CSV piden lo mismo (`datos=demo`). */
  demo?: boolean
  /** Filtros de la URL: el selector de ciudad de Operación arma su link con ellos. */
  state: MetricsState
}) {
  const tab = tabOf(id)
  const base = report as Report<string>
  const [trendKey, setTrendKey] = useState(tab.kpis[0])
  const { meta } = base
  const operations = tab.city ? (report as OperationsReport) : null
  const finance = tab.finance ? (report as FinanceReport) : null
  const city = operations?.city ?? null
  const exportHref = (section: string) => {
    const q = new URLSearchParams({
      from: meta.range.from,
      to: meta.range.to,
      section,
    })
    if (meta.band) q.set("band", meta.band)
    if (city) q.set("city", city)
    if (demo) q.set("datos", "demo")
    return `/api/reports/${id}/export?${q}`
  }
  const fallback = (section: string) => {
    const name = reportFileName(id, section, meta.range, meta.band, city)
    return demo ? demoFileName(name) : name
  }
  const trend = metricOf(id, trendKey)
  const rows = tab.kpiRows ?? [{ keys: tab.kpis }]
  const pending =
    id === "cashflow" ? (report as CashflowReport).pendingCapture : null
  const scope = city ? ` Solo los retirados en ${city}.` : ""

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] font-medium">{tab.question}</p>
        {operations && <CityPicker report={operations} state={state} />}
        {finance && (
          <CsvButton
            href={exportHref("settlements")}
            fallbackName={fallback("settlements")}
            label="CSV de liquidaciones"
          />
        )}
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((row, ri) => (
          <div
            key={ri}
            className="flex flex-wrap items-stretch gap-x-2 gap-y-3"
          >
            {row.keys.map((key, i) => (
              <KpiRowItem key={key} op={i > 0 ? row.ops?.[i - 1] : undefined}>
                <KpiCard
                  report={id}
                  metricKey={key}
                  base={base}
                  on={key === trendKey}
                  onPick={() => setTrendKey(key)}
                />
              </KpiRowItem>
            ))}
          </div>
        ))}
      </div>

      {pending && pending.count > 0 && (
        <p className="flex items-start gap-2 text-[13px] text-fg2">
          <Info className="mt-0.5 size-3.5 flex-none text-muted-foreground" />
          {pending.count}{" "}
          {pending.count === 1 ? "cobro espera" : "cobros esperan"} que Mercado
          Pago confirme la captura ({formatMetric("ars", pending.amountArs)}).
          No entran en el GMV ni en la comisión hasta entonces.
        </p>
      )}

      {finance && <FinanceNotices report={finance} />}

      {tab.flow && <DisputesFlow report={report as DisputesReport} />}

      <div className="flex flex-wrap items-stretch gap-4">
        <section className="flex min-w-0 flex-[2_1_520px] flex-col gap-3.5 rounded-[10px] border bg-card px-[18px] pt-[18px] pb-3.5">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 className="text-[15px] font-semibold">
                {trend.label}, {GRANULARITY_LABEL[meta.granularity]}
              </h2>
              <span className="text-[13px] text-pretty text-fg2">
                {trend.desc}
                {meta.band && meta.bandApplied
                  ? ` Solo ${bandLabelOf(meta.band)}.`
                  : ""}
                {scope}
              </span>
            </div>
            <CsvButton
              href={exportHref(`trend.${trendKey}`)}
              fallbackName={fallback(`trend.${trendKey}`)}
            />
          </div>
          <TrendChart
            points={base.series[trendKey] ?? []}
            total={base.kpis[trendKey] ?? { value: null, previous: null }}
            sums={trend.sums}
            unit={trend.unit}
            good={trend.good}
            granularity={meta.granularity}
            currentLabel={rangeLabel(meta.range)}
            target={trend.target}
          />
        </section>

        {tab.breakdowns.length > 0 && (
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
            {tab.breakdowns.map((panel) => {
              const bd = base.breakdowns.find(
                (b) => b.dimension === panel.dimension
              )
              return (
                <BreakdownCard
                  key={panel.dimension}
                  id={id}
                  panel={panel}
                  breakdown={bd}
                  band={meta.bandApplied ? meta.band : null}
                  bandApplied={meta.bandApplied}
                  highlight={panel.dimension === "reason" ? highlight : null}
                  csv={
                    <CsvButton
                      href={exportHref(`breakdown.${panel.dimension}`)}
                      fallbackName={fallback(`breakdown.${panel.dimension}`)}
                    />
                  }
                />
              )
            })}
          </div>
        )}
      </div>

      {finance && <DebtSnapshot report={finance} />}

      {tab.supply && (
        <SupplyCard
          points={(report as CarriersReport).supply ?? []}
          granularity={meta.granularity}
        />
      )}

      {tab.waterfalls && (
        <>
          <BridgeCard
            report={report as PricingReport}
            csv={
              <CsvButton
                href={exportHref("bridge")}
                fallbackName={fallback("bridge")}
              />
            }
          />
          <LeakageCard
            report={report as PricingReport}
            range={meta.range}
            csv={
              <CsvButton
                href={exportHref("leakage")}
                fallbackName={fallback("leakage")}
              />
            }
          />
        </>
      )}

      {tab.scorecard && (
        <>
          <CorridorMap report={report as DistancesReport} band={meta.band} />
          <Scorecard
            report={report as DistancesReport}
            band={meta.band}
            csv={
              <CsvButton
                href={exportHref("scorecard")}
                fallbackName={fallback("scorecard")}
              />
            }
          />
        </>
      )}
    </div>
  )
}

/** Un hueco entre tarjetas con el operador de la cuenta ("=", "×"); en el teléfono se apilan sin él. */
function KpiRowItem({
  op,
  children,
}: {
  op?: string
  children: React.ReactNode
}) {
  return (
    <>
      {op && (
        <span
          aria-hidden
          className="hidden w-5 items-center justify-center text-2xl font-light text-muted-foreground sm:flex"
        >
          {op}
        </span>
      )}
      <div className="flex min-w-[180px] flex-1">{children}</div>
    </>
  )
}

function KpiCard({
  report,
  metricKey,
  base,
  on,
  onPick,
}: {
  report: AdminReportId
  metricKey: string
  base: Report<string>
  on: boolean
  onPick: () => void
}) {
  const m = metricOf(report, metricKey)
  const v = base.kpis[metricKey] ?? { value: null, previous: null }
  const d = deltaOf(m.unit, m.good, v.value, v.previous)
  const series = base.series[metricKey] ?? []
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={cn(
        "flex w-full min-w-0 flex-col gap-2.5 rounded-[10px] border bg-card px-[18px] pt-4 pb-3 text-left transition-colors hover:border-fg2",
        on && "border-foreground shadow-[var(--shadow-3)]"
      )}
    >
      <span className="flex items-center gap-2 text-[13px] text-fg2">
        <span className="flex-1 truncate">{m.label}</span>
        {on && (
          <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap text-[#0a0a0b] uppercase">
            En el gráfico
          </span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[30px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
          {formatMetric(m.unit, v.value, true)}
        </span>
        <DeltaChip delta={d} />
      </span>
      <Sparkline
        values={series.map((p) => p.value)}
        previous={series.map((p) => p.previous)}
      />
      <span className="text-xs text-muted-foreground">
        Antes {formatMetric(m.unit, v.previous, true)}
        {m.target != null && (
          <>
            {" · "}
            <span
              className={cn(
                "font-medium",
                v.value == null
                  ? ""
                  : (
                        m.good === "up"
                          ? v.value >= m.target
                          : v.value <= m.target
                      )
                    ? "text-success-fg"
                    : "text-danger-fg"
              )}
            >
              Meta {formatMetric(m.unit, m.target)}
            </span>
          </>
        )}
      </span>
    </button>
  )
}

/**
 * Desglose. Lo que suma lleva arriba la composición (este período contra el anterior, para ver si
 * cambió el reparto); cada fila, su barra en el color de la entidad y una marca donde estaba antes.
 */
function BreakdownCard({
  id,
  panel,
  breakdown,
  band,
  bandApplied,
  highlight,
  csv,
}: {
  id: AdminReportId
  panel: BreakdownPanel
  breakdown: ReportBreakdown | undefined
  band: DistanceBand | null
  /** Sin filtro de distancia (Operación, Finanzas), el subtítulo no habla de distancias. */
  bandApplied: boolean
  highlight: string | null
  csv: React.ReactNode
}) {
  const m = metricOf(id, panel.metric)
  const extraMeta = panel.extra ? metricOf(id, panel.extra.key) : null
  const isBand = panel.dimension === "band"
  if (!breakdown)
    return (
      <section className="flex flex-1 flex-col gap-1.5 rounded-[10px] border bg-card p-[18px]">
        <h2 className="text-[15px] font-semibold">{panel.title}</h2>
        <span className="text-[13px] text-fg2">
          El servicio todavía no devuelve este desglose.
        </span>
      </section>
    )
  const max = Math.max(
    1,
    ...breakdown.rows.flatMap((r) => [r.value ?? 0, r.previous ?? 0])
  )
  const sub = `${m.sums ? `${formatMetric(m.unit, breakdown.total.value, true)} en total` : `${m.label} promedio ${formatMetric(m.unit, breakdown.total.value)}`}${isBand || !bandApplied ? "" : ` · ${bandLabelOf(band)}`}`
  const color = (key: string) => seriesColor(panel.dimension, key)
  return (
    <section className="flex flex-1 flex-col gap-1.5 rounded-[10px] border bg-card p-[18px]">
      <div className="mb-1.5 flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-[15px] font-semibold">{panel.title}</h2>
          <span className="text-xs text-muted-foreground">{sub}</span>
        </div>
        {csv}
      </div>
      {m.sums && (
        <Composition
          rows={breakdown.rows}
          total={breakdown.total}
          color={color}
          ink={(k) => seriesInk(panel.dimension, k)}
          label={(k) => dimensionKeyLabel(panel.dimension, k)}
        />
      )}
      {breakdown.rows.map((r) => {
        const d = deltaOf(m.unit, m.good, r.value, r.previous)
        const mark = highlight != null && r.key === highlight
        const off = isBand && band != null && band !== r.key
        const extra =
          panel.extra && extraMeta ? r.extra?.[panel.extra.key] : undefined
        return (
          <div
            key={r.key}
            className={cn(
              "-mx-2.5 flex flex-col gap-1.5 rounded-lg px-2.5 py-2",
              mark && "bg-info-soft",
              off && "opacity-40"
            )}
          >
            <div className="flex items-center gap-2 text-[13px]">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 flex-none rounded-[3px]"
                  style={{ background: color(r.key) }}
                />
                <span className={cn("truncate", mark && "font-semibold")}>
                  {dimensionKeyLabel(panel.dimension, r.key)}
                </span>
                {mark && (
                  <span className="inline-flex h-5 items-center rounded-full bg-info-soft px-2 text-[11px] font-semibold whitespace-nowrap text-info-fg">
                    Esta disputa
                  </span>
                )}
              </span>
              <span className="font-semibold tabular-nums">
                {formatMetric(m.unit, r.value, true)}
              </span>
              <span className="w-[44px] text-right text-xs text-muted-foreground tabular-nums">
                {r.share != null ? `${Math.round(r.share)} %` : ""}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${((r.value ?? 0) / max) * 100}%`,
                  background: color(r.key),
                }}
              />
              {r.previous != null && (
                <span
                  aria-hidden
                  title="Período anterior"
                  style={{ left: `${(r.previous / max) * 100}%` }}
                  className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground ring-2 ring-card"
                />
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex-1">
                {extra !== undefined && extraMeta
                  ? `${panel.extra!.label} ${formatMetric(extraMeta.unit, extra)}`
                  : `Antes ${formatMetric(m.unit, r.previous, true)}`}
              </span>
              <DeltaChip delta={d} className="h-5 px-1.5 text-[11px]" />
            </div>
          </div>
        )
      })}
      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="h-3 w-0.5 rounded-full bg-foreground" />
        Dónde estaba en el período anterior
      </span>
    </section>
  )
}

/** Reparto de un total en una barra al 100 %, este período sobre el anterior. */
function Composition({
  rows,
  total,
  color,
  ink,
  label,
}: {
  rows: ReportBreakdown["rows"]
  total: ReportBreakdown["total"]
  color: (key: string) => string
  ink: (key: string) => string
  label: (key: string) => string
}) {
  const lines = [
    {
      name: "Este período",
      pick: (r: (typeof rows)[number]) => r.value,
      sum: total.value,
    },
    {
      name: "Anterior",
      pick: (r: (typeof rows)[number]) => r.previous,
      sum: total.previous,
    },
  ]
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {lines.map((line) => (
        <div key={line.name} className="flex items-center gap-2.5">
          <span className="w-[76px] flex-none text-[11px] text-muted-foreground">
            {line.name}
          </span>
          <div className="flex h-5 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-[4px]">
            {line.sum
              ? rows.map((r) => {
                  const share = ((line.pick(r) ?? 0) / line.sum!) * 100
                  return (
                    <div
                      key={r.key}
                      title={`${label(r.key)}: ${Math.round(share)} %`}
                      style={{
                        flexGrow: share,
                        background: color(r.key),
                        color: ink(r.key),
                      }}
                      className="flex min-w-0 items-center justify-center overflow-hidden text-[10px] font-semibold"
                    >
                      {share >= 14 ? `${Math.round(share)} %` : ""}
                    </div>
                  )
                })
              : null}
          </div>
        </div>
      ))}
    </div>
  )
}
