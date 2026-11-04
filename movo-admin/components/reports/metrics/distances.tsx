"use client"
import dynamic from "next/dynamic"
import { useState, type ReactNode } from "react"
import { useTheme } from "next-themes"
import type {
  DistanceBand,
  DistancesReport,
  ReportCorridor,
} from "@movo/shared/src/types/admin-reports"
import {
  CORRIDOR_LOW_COMPLETION,
  SCORECARD_COLUMNS,
  bandLabelOf,
  corridorKey as keyOf,
} from "@/lib/reports/catalog"
import {
  BAND_LABEL,
  deltaOf,
  DELTA_CLASS,
  formatMetric,
} from "@/lib/reports/format"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { seriesColor } from "./chart-bits"

// Leaflet toca `window`: solo se carga en el navegador (mismo criterio que el mapa de seguimiento).
const CorridorMapCanvas = dynamic(() => import("./corridor-map-canvas"), {
  ssr: false,
  loading: () => <Skeleton className="absolute inset-0 rounded-none" />,
})

/**
 * "Mapa de corredores": cada corredor es un arco entre los centroides de sus ciudades; más grueso,
 * más envíos; en ámbar si el completado queda bajo el 88 %. Mapa y tabla se resaltan juntos.
 */
export function CorridorMap({
  report,
  band,
}: {
  report: DistancesReport
  band: DistanceBand | null
}) {
  const [hover, setHover] = useState<string | null>(null)
  const { resolvedTheme } = useTheme()
  const rows = report.corridors
  const total = rows.reduce((a, c) => a + c.published, 0)
  const focus = rows.find((c) => keyOf(c) === hover) ?? rows[0]
  const dim = (c: ReportCorridor) =>
    (band != null && band !== c.band) || (hover != null && hover !== keyOf(c))

  return (
    <section className="overflow-hidden rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-start gap-3 border-b px-[18px] py-4">
        <div className="flex flex-1 flex-col gap-1">
          <h2 className="text-[15px] font-semibold">Mapa de corredores</h2>
          <span className="text-xs text-muted-foreground">
            {rows.length} corredores con envíos publicados ·{" "}
            {formatMetric("n", total, true)} envíos en total ·{" "}
            {bandLabelOf(band)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-[22px] rounded-sm bg-[var(--corridor)]" />
            <span className="h-1.5 w-[22px] rounded-sm bg-[var(--corridor)]" />
            Más grueso, más envíos
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-[22px] rounded-sm bg-[var(--corridor-low)]" />
            Completado bajo {CORRIDOR_LOW_COMPLETION} %
          </span>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-[18px] py-10 text-center text-sm text-fg2">
          No hubo envíos publicados en este rango.
        </p>
      ) : (
        <div className="grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="relative h-[380px] border-b md:h-auto md:min-h-[460px] md:border-r md:border-b-0">
            <CorridorMapCanvas
              corridors={rows}
              hover={hover}
              onHover={setHover}
              band={band}
              theme={resolvedTheme === "dark" ? "dark" : "light"}
            />
            {focus && (
              <div className="pointer-events-none absolute top-3 left-3 z-[500] flex min-w-[190px] flex-col gap-0.5 rounded-[10px] border bg-card/90 px-3 py-2.5 shadow-[var(--shadow-3)] backdrop-blur-md">
                <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  {BAND_LABEL[focus.band]}
                  {hover == null ? " · el más usado" : ""}
                </span>
                <span className="text-sm font-semibold">
                  {focus.originCity} → {focus.destinationCity}
                </span>
                <span className="font-mono text-xs text-fg2">
                  {formatMetric("km", focus.distanceKm)} ·{" "}
                  {formatMetric("n", focus.published, true)} envíos ·{" "}
                  {formatMetric("pct", focus.completionRate)}
                </span>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="grid h-[38px] grid-cols-[minmax(0,1fr)_64px_64px] items-center gap-3 border-b bg-surface-sub px-[18px] text-xs font-medium text-muted-foreground">
              <span>Corredor</span>
              <span className="text-right">Envíos</span>
              <span className="text-right">Complet.</span>
            </div>
            {rows.map((c) => {
              const d = deltaOf("n", "up", c.published, c.publishedPrevious)
              const low = (c.completionRate ?? 100) < CORRIDOR_LOW_COMPLETION
              return (
                <div
                  key={keyOf(c)}
                  onMouseEnter={() => setHover(keyOf(c))}
                  onMouseLeave={() => setHover(null)}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_64px_64px] items-center gap-3 border-b px-[18px] py-[9px]",
                    hover === keyOf(c) && "bg-muted",
                    dim(c) && "opacity-45"
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-medium">
                      {c.originCity} → {c.destinationCity}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {formatMetric("km", c.distanceKm)} · {BAND_LABEL[c.band]}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-0.5">
                    <span className="text-[13px] font-medium tabular-nums">
                      {formatMetric("n", c.published, true)}
                    </span>
                    <span
                      className={cn(
                        "text-[11px] font-medium",
                        DELTA_CLASS[d.tone]
                      )}
                    >
                      {d.text}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "text-right text-[13px] font-medium tabular-nums",
                      low && "text-warn-fg"
                    )}
                  >
                    {formatMetric("pct", c.completionRate)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * -1 (el peor de los tres tramos) a 1 (el mejor) en una columna que se puede juzgar. `null`: la columna
 * no tiene "mejor" (envíos publicados, ticket) o falta el dato.
 */
export function heatScore(
  values: (number | null)[],
  good: "up" | "down",
  v: number | null
): number | null {
  const known = values.filter((x): x is number => x != null)
  if (v == null || known.length < 2) return null
  const lo = Math.min(...known)
  const hi = Math.max(...known)
  if (hi === lo) return 0
  const t = (v - lo) / (hi - lo)
  return (good === "up" ? t : 1 - t) * 2 - 1
}

/** Fondo de una celda: lima cuanto mejor (más tenue en oscuro, `--heat-lime`), rojo cuanto peor. */
const heatBg = (score: number | null) =>
  score == null || Math.abs(score) < 0.05
    ? undefined
    : score > 0
      ? `color-mix(in oklab, var(--lime) calc(${score.toFixed(2)} * var(--heat-lime)), transparent)`
      : `color-mix(in oklab, var(--dot-danger) ${Math.round(-score * 22)}%, transparent)`

/**
 * "Cómo rinde cada distancia" como mapa de calor: en cada columna que se puede juzgar, la celda del
 * mejor tramo va en azul y la del peor en rojo (con la palabra, no solo el color). Envíos y ticket no se
 * colorean: más largo no es mejor ni peor.
 */
export function Scorecard({
  report,
  band,
  csv,
}: {
  report: DistancesReport
  band: DistanceBand | null
  csv: ReactNode
}) {
  const judged = (c: (typeof SCORECARD_COLUMNS)[number]) =>
    !c.sums && c.key !== "avgTicket"
  const column = (c: (typeof SCORECARD_COLUMNS)[number]) =>
    report.scorecard.map((r) => r[c.key].value)
  return (
    <section className="overflow-hidden rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-start gap-3 border-b px-[18px] py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-[15px] font-semibold">
            Cómo rinde cada distancia
          </h2>
          <span className="text-xs text-pretty text-muted-foreground">
            Siempre compara los tres tramos, con el rango elegido. En cada
            columna, el color dice qué tramo anda mejor y cuál peor.
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          Peor
          <span
            aria-hidden
            className="h-2.5 w-24 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, color-mix(in oklab, var(--dot-danger) 22%, transparent), transparent 50%, color-mix(in oklab, var(--lime) var(--heat-lime), transparent))",
            }}
          />
          Mejor
        </div>
        {csv}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-separate border-spacing-1.5 px-3 py-2 text-left">
          <thead>
            <tr className="text-xs font-medium text-muted-foreground">
              <th scope="col" className="w-[140px] px-1.5 py-1 font-medium">
                Distancia
              </th>
              {SCORECARD_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="px-2.5 py-1 text-right font-medium"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.scorecard.map((row) => (
              <tr
                key={row.band}
                className={cn(
                  band != null && band !== row.band && "opacity-45"
                )}
              >
                <th
                  scope="row"
                  className={cn(
                    "rounded-lg px-1.5 py-2 text-sm font-semibold",
                    band === row.band && "bg-muted"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 rounded-[3px]"
                      style={{ background: seriesColor("band", row.band) }}
                    />
                    {BAND_LABEL[row.band]}
                  </span>
                </th>
                {SCORECARD_COLUMNS.map((c) => {
                  const v = row[c.key]
                  const d = deltaOf(c.unit, c.good, v.value, v.previous)
                  const score = judged(c)
                    ? heatScore(column(c), c.good, v.value)
                    : null
                  const tag =
                    score === 1 ? "Mejor" : score === -1 ? "Peor" : null
                  return (
                    <td
                      key={c.key}
                      style={{ background: heatBg(score) }}
                      className={cn(
                        "rounded-lg px-2.5 py-2.5 text-right",
                        score == null && "bg-surface-sub"
                      )}
                    >
                      <span className="flex flex-col items-end gap-0.5">
                        <span className="text-[15px] font-semibold tabular-nums">
                          {formatMetric(c.unit, v.value, true)}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs">
                          {tag && (
                            <span className="text-[10px] font-semibold tracking-[0.06em] text-fg2 uppercase">
                              {tag}
                            </span>
                          )}
                          <span
                            className={cn("font-medium", DELTA_CLASS[d.tone])}
                          >
                            {d.text}
                          </span>
                        </span>
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
