"use client"
import { useId, useState } from "react"
import type {
  ReportGranularity,
  ReportPoint,
  ReportValue,
} from "@movo/shared/src/types/admin-reports"
import {
  bucketLabels,
  deltaOf,
  DELTA_CLASS,
  formatMetric,
  niceMax,
  type MetricUnit,
} from "@/lib/reports/format"
import { cn } from "@/lib/utils"
import { DeltaChip } from "./chart-bits"

const W = 1000
const H = 220

/** Trazo de una serie; un bucket sin dato (`null`) corta la línea en vez de inventar un cero. */
function pathOf(
  values: (number | null)[],
  x: (j: number) => number,
  y: (v: number) => number
) {
  let d = ""
  let pen = false
  values.forEach((v, j) => {
    if (v == null) {
      pen = false
      return
    }
    d += `${pen ? "L" : "M"}${x(j).toFixed(1)} ${y(v).toFixed(1)} `
    pen = true
  })
  return d.trim()
}

/**
 * Tendencia de una métrica contra el período anterior. Arriba, el número del período y su variación.
 * Lo que suma (envíos, plata) va en columnas, con la columna del anterior detrás; lo que promedia
 * (tasas, tiempos), en línea con área y el anterior punteado. Se marca el pico. Un solo eje Y.
 */
export function TrendChart({
  points,
  total,
  unit,
  good,
  sums,
  granularity,
  currentLabel,
  target,
}: {
  points: ReportPoint[]
  /** El KPI del período completo (lo que va en grande). */
  total: ReportValue
  unit: MetricUnit
  good: "up" | "down"
  sums: boolean
  granularity: ReportGranularity
  currentLabel: string
  /** Meta: línea punteada con su etiqueta. */
  target?: number
}) {
  const gradient = useId()
  const [hover, setHover] = useState(-1)
  const n = points.length
  const values = points.map((p) => p.value)
  const prev = points.map((p) => p.previous)
  const known = values.filter((v): v is number => v != null)
  // Un porcentaje no pasa de 100: el eje tampoco (niceMax(97 × 1,12) daría 200).
  const yMax = (
    unit === "pct" ? (v: number) => Math.min(niceMax(v), 100) : niceMax
  )(
    Math.max(
      0,
      ...known,
      ...prev.filter((v): v is number => v != null),
      target ?? 0
    ) * 1.12
  )
  const bw = W / Math.max(n, 1)
  const x = (j: number) => (j + 0.5) * bw
  const y = (v: number) => H - (v / yMax) * H
  const pct = (v: number) => `${(v / yMax) * 100}%`
  const cur = pathOf(values, x, y)
  const firstIdx = values.findIndex((v) => v != null)
  const lastIdx = values.findLastIndex((v) => v != null)
  const area =
    cur && firstIdx >= 0
      ? `${cur} L${x(lastIdx)} ${H} L${x(firstIdx)} ${H} Z`
      : ""
  // El pico (o el valle si "menos" es bueno): una sola etiqueta directa, no un número en cada punto.
  // Lo que suma marca el pico (un "mejor 0 disputas" no dice nada); lo que promedia, el mejor valor.
  const peak = sums || good === "up"
  const best = known.length
    ? values.indexOf(peak ? Math.max(...known) : Math.min(...known))
    : -1
  const step = Math.max(1, Math.ceil(n / 7))
  const xTicks = points
    .map((p, j) => ({ j, label: bucketLabels(p, granularity).short }))
    .filter((t) => (n - 1 - t.j) % step === 0)
  const hv = hover >= 0 && hover < n ? points[hover] : null
  const left = hover >= 0 ? ((hover + 0.5) / n) * 100 : 0
  const d = hv ? deltaOf(unit, good, hv.value, hv.previous) : null
  const head = deltaOf(unit, good, total.value, total.previous)

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span className="text-[28px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
            {formatMetric(unit, total.value, true)}
          </span>
          <DeltaChip delta={head} />
        </div>
        <span className="pb-0.5 text-xs text-muted-foreground">
          {sums ? "en el período" : "en promedio"} · antes{" "}
          {formatMetric(unit, total.previous, true)}
        </span>
        <span className="ml-auto flex gap-4 pb-0.5 text-xs text-fg2">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "bg-foreground",
                sums ? "size-2.5 rounded-[3px]" : "h-0.5 w-3.5 rounded-sm"
              )}
            />
            {currentLabel}
          </span>
          <span className="flex items-center gap-1.5">
            {sums ? (
              <span className="size-2.5 rounded-[3px] bg-border-strong" />
            ) : (
              <span className="w-3.5 border-t-2 border-dashed border-muted-foreground" />
            )}
            Período anterior
          </span>
        </span>
      </div>
      <div className="relative ml-14 h-[240px]">
        {[0, 1, 2, 3, 4].map((k) => (
          <span
            key={k}
            aria-hidden
            style={{ top: `${100 - k * 25}%` }}
            className="absolute right-[calc(100%+10px)] -translate-y-1/2 font-mono text-[11px] whitespace-nowrap text-muted-foreground"
          >
            {formatMetric(unit, (yMax * k) / 4, true)}
          </span>
        ))}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
          className="absolute inset-0 block size-full overflow-visible"
        >
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--lime)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--lime)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {hover >= 0 && (
            <rect
              x={hover * bw}
              y={0}
              width={bw}
              height={H}
              className="fill-muted"
            />
          )}
          {[0, 1, 2, 3, 4].map((k) => (
            <line
              key={k}
              x1={0}
              x2={W}
              y1={(H * k) / 4}
              y2={(H * k) / 4}
              strokeWidth={1}
              strokeDasharray={k === 4 ? undefined : "2 4"}
              vectorEffect="non-scaling-stroke"
              className={k === 4 ? "stroke-border-strong" : "stroke-border"}
            />
          ))}
          {!sums && (
            <>
              <path
                d={pathOf(prev, x, y)}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
                className="stroke-muted-foreground"
              />
              {area && <path d={area} fill={`url(#${gradient})`} />}
              <path
                d={cur}
                fill="none"
                strokeWidth={2.25}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className="stroke-foreground"
              />
            </>
          )}
        </svg>
        {sums && (
          <div aria-hidden className="absolute inset-0 flex">
            {points.map((p, j) => (
              <div
                key={p.start}
                className="relative h-full flex-1"
                style={{ padding: `0 ${n > 40 ? 1 : n > 16 ? 2 : 6}px` }}
              >
                <div className="relative mx-auto h-full w-full max-w-[44px]">
                  {p.previous != null && (
                    <div
                      style={{ height: pct(p.previous) }}
                      className="absolute right-0 bottom-0 left-0 rounded-t-[4px] bg-border-strong/70"
                    />
                  )}
                  {p.value != null && (
                    <div
                      style={{ height: pct(p.value) }}
                      className={cn(
                        "absolute right-[18%] bottom-0 left-[18%] rounded-t-[4px] transition-colors",
                        hover === j || (hover === -1 && j === best)
                          ? "bg-lime ring-1 ring-[var(--lime-edge)] ring-inset"
                          : hover === -1
                            ? "bg-foreground"
                            : "bg-foreground/45"
                      )}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {target != null && (
          <div
            aria-hidden
            style={{ bottom: pct(target) }}
            className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-foreground/60"
          >
            <span className="absolute right-0 -translate-y-1/2 rounded-full border border-foreground/60 bg-card px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap">
              Meta {formatMetric(unit, target)}
            </span>
          </div>
        )}
        {!sums && lastIdx >= 0 && hover < 0 && (
          <span
            aria-hidden
            style={{
              left: `${((lastIdx + 0.5) / n) * 100}%`,
              top: pct(yMax - values[lastIdx]!),
            }}
            className="pointer-events-none absolute -mt-[5px] -ml-[5px] size-[10px] rounded-full border-2 border-foreground bg-lime"
          />
        )}
        {best >= 0 && hover < 0 && (
          <span
            aria-hidden
            style={{
              left: `${((best + 0.5) / n) * 100}%`,
              bottom: `calc(${pct(values[best]!)} + 8px)`,
              transform:
                best > n * 0.8
                  ? "translateX(-100%)"
                  : best < n * 0.2
                    ? "none"
                    : "translateX(-50%)",
            }}
            className="pointer-events-none absolute rounded-full bg-lime px-2 py-0.5 font-mono text-[11px] font-semibold whitespace-nowrap text-[#0a0a0b]"
          >
            {peak ? "Pico" : "Mejor"} {formatMetric(unit, values[best], true)}
          </span>
        )}
        <div
          className="absolute inset-0 flex"
          onMouseLeave={() => setHover(-1)}
        >
          {points.map((p, j) => (
            <div
              key={p.start}
              className="h-full flex-1"
              onMouseEnter={() => setHover(j)}
            />
          ))}
        </div>
        {hv && (
          <>
            {!sums &&
              [
                { v: hv.value, cls: "border-foreground" },
                { v: hv.previous, cls: "border-muted-foreground" },
              ]
                .filter((dot) => dot.v != null)
                .map((dot) => (
                  <span
                    key={dot.cls}
                    style={{
                      left: `${left}%`,
                      top: `${100 - (dot.v! / yMax) * 100}%`,
                    }}
                    className={cn(
                      "pointer-events-none absolute -mt-[4.5px] -ml-[4.5px] size-[9px] rounded-full border-2 bg-card",
                      dot.cls
                    )}
                  />
                ))}
            <div
              role="tooltip"
              style={{
                left: `${left}%`,
                transform:
                  left > 62
                    ? "translateX(calc(-100% - 14px))"
                    : "translateX(14px)",
              }}
              className="pointer-events-none absolute top-1.5 z-[2] flex min-w-[200px] flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-xs shadow-[var(--shadow-3)]"
            >
              <span className="font-semibold">
                {bucketLabels(hv, granularity).long}
              </span>
              {[
                {
                  name: "Este período",
                  value: formatMetric(unit, hv.value),
                  cls: "text-foreground",
                },
                {
                  name: "Período anterior",
                  value: formatMetric(unit, hv.previous),
                  cls: "text-fg2",
                },
                {
                  name: "Variación",
                  value: d!.text,
                  cls: DELTA_CLASS[d!.tone],
                },
              ].map((r) => (
                <span key={r.name} className="flex items-center gap-2">
                  <span className="flex-1 whitespace-nowrap text-fg2">
                    {r.name}
                  </span>
                  <span
                    className={cn(
                      "font-mono font-medium whitespace-nowrap",
                      r.cls
                    )}
                  >
                    {r.value}
                  </span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <div aria-hidden className="relative ml-14 h-4">
        {xTicks.map((t) => (
          <span
            key={t.j}
            style={{ left: `${((t.j + 0.5) / n) * 100}%` }}
            className="absolute -translate-x-1/2 text-[11px] whitespace-nowrap text-muted-foreground"
          >
            {t.label}
          </span>
        ))}
      </div>
      <details className="text-xs text-fg2">
        <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">
          Ver como tabla
        </summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Período</th>
              <th className="py-1 text-right font-medium">Valor</th>
              <th className="py-1 text-right font-medium">Anterior</th>
              <th className="py-1 text-right font-medium">Variación</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => {
              const dd = deltaOf(unit, good, p.value, p.previous)
              return (
                <tr key={p.start} className="border-t">
                  <td className="py-1">{bucketLabels(p, granularity).long}</td>
                  <td className="py-1 text-right">
                    {formatMetric(unit, p.value)}
                  </td>
                  <td className="py-1 text-right">
                    {formatMetric(unit, p.previous)}
                  </td>
                  <td className={cn("py-1 text-right", DELTA_CLASS[dd.tone])}>
                    {dd.text}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </details>
    </div>
  )
}
