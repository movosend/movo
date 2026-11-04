"use client"
import { useState, type ReactNode } from "react"
import type {
  PricingReport,
  ReportRange,
} from "@movo/shared/src/types/admin-reports"
import { LEAKAGE_STEP } from "@/lib/reports/catalog"
import { formatMetric, rangeLabel, signedArs } from "@/lib/reports/format"
import {
  bridgeBars,
  leakageBars,
  type LeakageMode,
} from "@/lib/reports/waterfall"
import { cn } from "@/lib/utils"
import { WaterfallChart } from "./waterfall-chart"

function Card({
  title,
  sub,
  action,
  children,
}: {
  title: string
  sub: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-[10px] border bg-card px-[18px] pt-[18px] pb-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <span className="text-[13px] text-pretty text-fg2">{sub}</span>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-muted px-4 py-8 text-center text-sm text-fg2">
      {children}
    </p>
  )
}

const pctOf = (part: number, whole: number) =>
  whole ? `${formatMetric("pct", (part / whole) * 100)}` : "—"

/** Puente del GMV: volumen, mix y cada componente del precio, del período anterior a este. */
export function BridgeCard({
  report,
  csv,
}: {
  report: PricingReport
  csv: ReactNode
}) {
  const { bridge, meta } = report
  const sub = `GMV de envíos completados, ${rangeLabel(meta.previous, false)} → ${rangeLabel(meta.range)}. Los pasos suman exacto la diferencia.`
  if (!bridge)
    return (
      <Card title="Qué movió el GMV" sub={sub} action={csv}>
        <Empty>
          No hubo envíos completados en alguno de los dos períodos: no hay
          contra qué comparar.
        </Empty>
      </Card>
    )
  const { bars, groups } = bridgeBars(bridge)
  const change = bridge.current - bridge.previous
  const price = groups[0]?.value ?? 0
  const parts = [
    { label: "Volumen", value: bridge.volume },
    { label: "Mix de distancias", value: bridge.mix },
    { label: "Precio", value: price },
  ]
  const lead = [...parts].sort(
    (a, b) => Math.abs(b.value) - Math.abs(a.value)
  )[0]
  return (
    <Card title="Qué movió el GMV" sub={sub} action={csv}>
      <p className="text-[15px] text-pretty">
        El GMV {change >= 0 ? "creció" : "cayó"}{" "}
        <strong className="font-semibold tabular-nums">
          {signedArs(change)}
        </strong>{" "}
        ({pctOf(change, bridge.previous)}). Lo que más pesó fue{" "}
        <strong className="font-semibold">{lead.label.toLowerCase()}</strong>.
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
        {parts.map((p) => (
          <div
            key={p.label}
            className="flex flex-col gap-1 rounded-lg border px-3 py-2.5"
          >
            <span className="text-xs text-fg2">{p.label}</span>
            <span
              className={cn(
                "text-lg leading-none font-semibold tabular-nums",
                p.value < 0 && "text-danger-fg"
              )}
            >
              {signedArs(p.value)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {change ? `${pctOf(p.value, change)} del cambio` : " "}
            </span>
          </div>
        ))}
      </div>
      <WaterfallChart
        bars={bars}
        groups={groups}
        label={`Puente del GMV de ${formatMetric("ars", bridge.previous)} a ${formatMetric("ars", bridge.current)}`}
      />
    </Card>
  )
}

/** Fugas de captura: de lo cotizado a lo capturado, en GMV o en comisión. */
export function LeakageCard({
  report,
  range,
  csv,
}: {
  report: PricingReport
  range: ReportRange
  csv: ReactNode
}) {
  const [mode, setMode] = useState<LeakageMode>("gmv")
  const { leakage } = report
  const sub = `Envíos publicados del ${rangeLabel(range)}, a su precio cotizado. Va por fecha de publicación: no coincide con el GMV de Cashflow, que va por fecha de completado.`
  const toggle = (
    <div
      role="group"
      aria-label="Ver en"
      className="inline-flex h-8 rounded-lg border bg-muted p-0.5 text-xs font-medium"
    >
      {(
        [
          ["gmv", "GMV"],
          ["commission", "Comisión"],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          type="button"
          aria-pressed={mode === k}
          onClick={() => setMode(k)}
          className={cn(
            "rounded-md px-3 text-fg2 transition-colors",
            mode === k && "bg-card text-foreground shadow-sm"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
  const action = (
    <div className="flex items-center gap-2">
      {toggle}
      {csv}
    </div>
  )
  if (!leakage)
    return (
      <Card title="Dónde se pierde lo cotizado" sub={sub} action={action}>
        <Empty>No hubo envíos publicados en este rango.</Empty>
      </Card>
    )
  const amount = (a: { gmvArs: number; commissionArs: number }) =>
    mode === "gmv" ? a.gmvArs : a.commissionArs
  const quoted = amount(leakage.quoted)
  const lost = leakage.steps
    .filter((s) => !s.timing)
    .reduce((a, s) => a + amount(s), 0)
  const pending = leakage.steps
    .filter((s) => s.timing)
    .reduce((a, s) => a + amount(s), 0)
  const worst = leakage.steps
    .filter((s) => !s.timing && amount(s) > 0)
    .sort((a, b) => amount(b) - amount(a))[0]
  const what = mode === "gmv" ? "del GMV cotizado" : "de la comisión cotizada"
  return (
    <Card title="Dónde se pierde lo cotizado" sub={sub} action={action}>
      <div className="flex flex-col gap-2.5">
        <p className="text-[15px] text-pretty">
          Se capturó el{" "}
          <strong className="font-semibold tabular-nums">
            {pctOf(amount(leakage.captured), quoted)}
          </strong>{" "}
          {what}. Se perdió el{" "}
          <strong className="font-semibold text-danger-fg tabular-nums">
            {pctOf(lost, quoted)}
          </strong>{" "}
          y el{" "}
          <strong className="font-semibold tabular-nums">
            {pctOf(pending, quoted)}
          </strong>{" "}
          todavía puede entrar.
        </p>
        {worst && (
          <p className="text-[13px] text-fg2">
            La fuga más grande es{" "}
            <span className="font-medium text-foreground">
              {LEAKAGE_STEP[worst.key].label.toLowerCase()}
            </span>
            : {formatMetric("ars", amount(worst), true)} en{" "}
            {formatMetric("n", worst.shipments)}{" "}
            {worst.shipments === 1 ? "envío" : "envíos"}.
          </p>
        )}
        {/* Lo mismo en una barra: capturado, perdido y en camino sobre el cotizado. */}
        <div
          aria-hidden
          className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
        >
          <div
            className="bg-foreground"
            style={{ flexGrow: amount(leakage.captured) }}
          />
          <div className="bg-[var(--wf-down)]" style={{ flexGrow: lost }} />
          <div className="mv-hatch" style={{ flexGrow: pending }} />
        </div>
      </div>
      <WaterfallChart
        bars={leakageBars(leakage, mode)}
        label={`Cascada de fugas de captura ${what}`}
      />
    </Card>
  )
}
