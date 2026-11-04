"use client"
import { useState } from "react"
import type {
  CarrierSupplyPoint,
  ReportGranularity,
} from "@movo/shared/src/types/admin-reports"
import { bucketLabels, formatMetric, niceMax } from "@/lib/reports/format"
import { cn } from "@/lib/utils"

/** Totales del período: publicados, asignados en 24 h y los que se quedaron sin transportista a tiempo. */
export function supplyTotals(points: CarrierSupplyPoint[]) {
  const published = points.reduce((a, p) => a + (p.published ?? 0), 0)
  const assigned = points.reduce((a, p) => a + (p.assignedWithin24h ?? 0), 0)
  return {
    published,
    assigned,
    gap: Math.max(published - assigned, 0),
    rate: published ? (assigned / published) * 100 : null,
  }
}

/**
 * Oferta contra demanda: cada columna es lo publicado en el bucket; abajo, en tinta, lo que consiguió
 * transportista en 24 h, y arriba, en rojo, lo que no. Donde la parte roja crece falta gente.
 */
export function SupplyCard({
  points,
  granularity,
}: {
  points: CarrierSupplyPoint[]
  granularity: ReportGranularity
}) {
  const [hover, setHover] = useState(-1)
  const t = supplyTotals(points)
  const max = niceMax(Math.max(1, ...points.map((p) => p.published ?? 0)) * 1.1)
  const n = points.length
  const step = Math.max(1, Math.ceil(n / 7))
  const hv = hover >= 0 ? points[hover] : null
  // El bucket con más envíos sin asignar a tiempo: el que hay que mirar.
  const worst = points.reduce(
    (best, p, j) => {
      const g = (p.published ?? 0) - (p.assignedWithin24h ?? 0)
      return g > best.g ? { j, g } : best
    },
    { j: -1, g: 0 }
  ).j

  return (
    <section className="flex flex-col gap-4 rounded-[10px] border bg-card px-[18px] pt-[18px] pb-3.5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold">
          Publicados contra asignados en 24 h
        </h2>
        <span className="text-[13px] text-pretty text-fg2">
          Cada columna es lo que se publicó. Lo rojo no consiguió transportista
          en 24 h: ahí falta gente.
        </span>
      </div>
      <p className="text-[15px] text-pretty">
        De{" "}
        <strong className="font-semibold tabular-nums">
          {formatMetric("n", t.published)}
        </strong>{" "}
        envíos publicados,{" "}
        <strong className="font-semibold tabular-nums">
          {formatMetric("n", t.assigned)}
        </strong>{" "}
        consiguieron transportista en 24 h ({formatMetric("pct", t.rate)}).{" "}
        <strong className="font-semibold text-danger-fg tabular-nums">
          {formatMetric("n", t.gap)}
        </strong>{" "}
        no.
      </p>
      <div className="flex gap-4 text-xs text-fg2">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-foreground" />
          Asignados en 24 h
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-[var(--dot-danger)]" />
          Sin transportista en 24 h
        </span>
      </div>
      <div className="relative ml-10 h-[200px]">
        {[0, 1, 2, 3, 4].map((k) => (
          <div
            key={k}
            aria-hidden
            style={{ bottom: `${k * 25}%` }}
            className={cn(
              "absolute inset-x-0 border-t",
              k === 0 ? "border-border-strong" : "border-dashed"
            )}
          >
            <span className="absolute right-[calc(100%+8px)] -translate-y-1/2 font-mono text-[11px] text-muted-foreground">
              {formatMetric("n", (max * k) / 4, true)}
            </span>
          </div>
        ))}
        <div
          role="img"
          aria-label={`${t.published} publicados, ${t.assigned} asignados en 24 h`}
          className="absolute inset-0 flex"
          onMouseLeave={() => setHover(-1)}
        >
          {points.map((p, j) => {
            const pub = p.published ?? 0
            const ok = Math.min(p.assignedWithin24h ?? 0, pub)
            return (
              <div
                key={p.start}
                className="relative h-full flex-1"
                style={{ padding: `0 ${n > 40 ? 1 : n > 16 ? 2 : 6}px` }}
                onMouseEnter={() => setHover(j)}
              >
                <div
                  className={cn(
                    "absolute inset-x-[18%] bottom-0 flex flex-col overflow-hidden rounded-t-[4px] transition-opacity",
                    hover >= 0 && hover !== j && "opacity-45",
                    hover < 0 && j === worst && "ring-2 ring-lime"
                  )}
                  style={{ height: `${(pub / max) * 100}%` }}
                >
                  <div
                    className="bg-[var(--dot-danger)]"
                    style={{ flexGrow: pub - ok }}
                  />
                  <div
                    className="bg-foreground"
                    style={{ flexGrow: ok, minHeight: ok ? 1 : 0 }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        {hv && (
          <div
            role="tooltip"
            style={{
              left: `${((hover + 0.5) / n) * 100}%`,
              transform:
                hover > n * 0.6
                  ? "translateX(calc(-100% - 14px))"
                  : "translateX(14px)",
            }}
            className="pointer-events-none absolute top-1 z-[2] flex min-w-[200px] flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-xs shadow-[var(--shadow-3)]"
          >
            <span className="font-semibold">
              {bucketLabels(hv, granularity).long}
            </span>
            {[
              ["Publicados", hv.published],
              ["Asignados en 24 h", hv.assignedWithin24h],
              [
                "Sin transportista",
                hv.published != null && hv.assignedWithin24h != null
                  ? hv.published - hv.assignedWithin24h
                  : null,
              ],
            ].map(([name, v]) => (
              <span key={name as string} className="flex items-center gap-2">
                <span className="flex-1 text-fg2">{name}</span>
                <span className="font-mono font-medium">
                  {formatMetric("n", v as number | null)}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div aria-hidden className="relative ml-10 h-4">
        {points.map((p, j) =>
          (n - 1 - j) % step === 0 ? (
            <span
              key={p.start}
              style={{ left: `${((j + 0.5) / n) * 100}%` }}
              className="absolute -translate-x-1/2 text-[11px] whitespace-nowrap text-muted-foreground"
            >
              {bucketLabels(p, granularity).short}
            </span>
          ) : null
        )}
      </div>
      {worst >= 0 && (
        <span className="flex items-center gap-1.5 text-xs text-fg2">
          <span className="size-2.5 rounded-[3px] ring-2 ring-lime" />
          {bucketLabels(points[worst], granularity).long}: el bucket con más
          envíos sin transportista a tiempo.
        </span>
      )}
      <details className="text-xs text-fg2">
        <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">
          Ver como tabla
        </summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Período</th>
              <th className="py-1 text-right font-medium">Publicados</th>
              <th className="py-1 text-right font-medium">Asignados en 24 h</th>
              <th className="py-1 text-right font-medium">Sin transportista</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.start} className="border-t">
                <td className="py-1">{bucketLabels(p, granularity).long}</td>
                <td className="py-1 text-right">
                  {formatMetric("n", p.published)}
                </td>
                <td className="py-1 text-right">
                  {formatMetric("n", p.assignedWithin24h)}
                </td>
                <td className="py-1 text-right">
                  {p.published != null && p.assignedWithin24h != null
                    ? formatMetric("n", p.published - p.assignedWithin24h)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
