"use client"
import { useState } from "react"
import { axisArs, formatMetric, signedArs } from "@/lib/reports/format"
import {
  waterfallDomain,
  type WaterfallBar,
  type WaterfallGroup,
} from "@/lib/reports/waterfall"
import { cn } from "@/lib/utils"

const FILL: Record<WaterfallBar["kind"], string> = {
  total: "bg-foreground",
  up: "bg-lime ring-1 ring-[var(--lime-edge)] ring-inset",
  down: "bg-[var(--wf-down)]",
  timing: "mv-hatch border border-dashed border-muted-foreground/60",
}

const KIND_LABEL: Record<WaterfallBar["kind"], string> = {
  total: "Total",
  up: "Suma",
  down: "Resta",
  timing: "En camino",
}

/**
 * Cascada en montos (ARS). Los totales salen de la base; cada paso flota entre el nivel de antes y el
 * de después, unido al siguiente por una guía punteada. Azul suma, rojo resta, rayado "todavía puede
 * entrar". Si el eje no arranca en cero, se dice. Hover con la explicación del paso; tabla debajo.
 */
export function WaterfallChart({
  bars,
  groups = [],
  label,
}: {
  bars: WaterfallBar[]
  groups?: WaterfallGroup[]
  /** Para lectores de pantalla. */
  label: string
}) {
  const [hover, setHover] = useState(-1)
  const { lo, hi, cut } = waterfallDomain(bars)
  const span = hi - lo
  const pos = (v: number) => ((Math.max(v, lo) - lo) / span) * 100
  const start = bars[0]?.value ?? 0
  const kinds = new Set(bars.map((b) => b.kind))
  const hv = hover >= 0 ? bars[hover] : null
  const n = bars.length
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg2">
        {(["up", "down", "timing", "total"] as const)
          .filter((k) => kinds.has(k))
          .map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-[3px]", FILL[k])} />
              {KIND_LABEL[k]}
            </span>
          ))}
        {cut && (
          <span className="ml-auto text-muted-foreground">
            El eje arranca en {axisArs(lo)} para que se vean los pasos.
          </span>
        )}
      </div>
      <div className="-mx-1 overflow-x-auto px-1 pt-3 pb-1">
        <div className="min-w-[640px]">
          <div
            role="img"
            aria-label={label}
            className="relative ml-14 h-[260px]"
          >
            {[0, 1, 2, 3, 4].map((k) => (
              <span
                key={k}
                aria-hidden
                style={{ bottom: `${k * 25}%` }}
                className="absolute right-[calc(100%+10px)] translate-y-1/2 font-mono text-[11px] whitespace-nowrap text-muted-foreground"
              >
                {axisArs(lo + (span * k) / 4)}
              </span>
            ))}
            {[0, 1, 2, 3, 4].map((k) => (
              <div
                key={k}
                aria-hidden
                style={{ bottom: `${k * 25}%` }}
                className={cn(
                  "absolute inset-x-0 border-t",
                  k === 0 ? "border-border-strong" : "border-dashed"
                )}
              />
            ))}
            {cut && (
              <svg
                aria-hidden
                viewBox="0 0 16 8"
                className="absolute -bottom-1 -left-2 h-2 w-4 text-muted-foreground"
              >
                <path
                  d="M0 6 L4 2 L8 6 L12 2 L16 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                />
              </svg>
            )}
            <div
              className="absolute inset-0 grid"
              style={cols}
              onMouseLeave={() => setHover(-1)}
            >
              {bars.map((b, i) => {
                const a = b.kind === "total" ? lo : Math.min(b.from, b.to)
                const z = b.kind === "total" ? b.to : Math.max(b.from, b.to)
                const bottom = pos(a)
                const height = Math.max(pos(z) - bottom, 0.6)
                const next = bars[i + 1]
                const dim = hover >= 0 && hover !== i
                return (
                  <div
                    key={b.key}
                    className="relative h-full"
                    onMouseEnter={() => setHover(i)}
                  >
                    {hover === i && (
                      <div className="absolute inset-0 rounded-md bg-muted" />
                    )}
                    <div
                      style={{ bottom: `${bottom}%`, height: `${height}%` }}
                      className={cn(
                        "absolute inset-x-[16%] rounded-[4px] transition-opacity",
                        FILL[b.kind],
                        dim && "opacity-45"
                      )}
                    />
                    <span
                      aria-hidden
                      style={{ bottom: `calc(${bottom + height}% + 4px)` }}
                      className={cn(
                        "absolute inset-x-0 text-center font-mono text-[11px] font-medium whitespace-nowrap tabular-nums",
                        b.kind === "total" ? "text-foreground" : "text-fg2"
                      )}
                    >
                      {b.kind === "total"
                        ? formatMetric("ars", b.value, true)
                        : signedArs(b.value)}
                    </span>
                    {next && (
                      <div
                        aria-hidden
                        style={{ bottom: `${pos(b.to)}%` }}
                        className="absolute left-[84%] w-[32%] border-t border-dashed border-muted-foreground/70"
                      />
                    )}
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
                      ? "translateX(calc(-100% - 18px))"
                      : "translateX(18px)",
                }}
                className="pointer-events-none absolute top-1 z-[2] flex w-[240px] flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-xs shadow-[var(--shadow-3)]"
              >
                <span className="font-semibold">{hv.label}</span>
                {hv.desc && (
                  <span className="text-pretty text-fg2">{hv.desc}</span>
                )}
                <span className="flex items-center gap-2">
                  <span className="flex-1 text-fg2">
                    {hv.kind === "total" ? "Total" : "Impacto"}
                  </span>
                  <span className="font-mono font-medium">
                    {hv.kind === "total"
                      ? formatMetric("ars", hv.value)
                      : signedArs(hv.value, false)}
                  </span>
                </span>
                {hv.kind !== "total" && start !== 0 && (
                  <span className="flex items-center gap-2">
                    <span className="flex-1 text-fg2">Sobre el inicio</span>
                    <span className="font-mono font-medium">
                      {formatMetric("pct", (hv.value / start) * 100)}
                    </span>
                  </span>
                )}
                {hv.shipments != null && (
                  <span className="flex items-center gap-2">
                    <span className="flex-1 text-fg2">Envíos</span>
                    <span className="font-mono font-medium">
                      {formatMetric("n", hv.shipments)}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="mt-2 ml-14 grid gap-x-1" style={cols}>
            {bars.map((b, i) => (
              <span
                key={b.key}
                className={cn(
                  "text-center text-[11px] leading-tight text-balance",
                  b.kind === "total"
                    ? "font-semibold text-foreground"
                    : "text-fg2",
                  hover === i && "text-foreground"
                )}
              >
                {b.label}
                {b.shipments != null && (
                  <span className="block font-mono text-[10px] text-muted-foreground">
                    {formatMetric("n", b.shipments, true)} env.
                  </span>
                )}
              </span>
            ))}
            {groups.map((g) => (
              <div
                key={g.label}
                style={{ gridColumn: `${g.first + 1} / ${g.last + 2}` }}
                className="mt-1.5 flex flex-col items-center gap-1"
              >
                <span className="h-2 w-full rounded-b-md border-x border-b border-border-strong" />
                <span className="text-[11px] font-semibold whitespace-nowrap">
                  {g.label}{" "}
                  <span className="font-mono text-fg2">
                    {signedArs(g.value)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <details className="text-xs text-fg2">
        <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">
          Ver como tabla
        </summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Paso</th>
              <th className="py-1 text-right font-medium">Impacto</th>
              <th className="py-1 text-right font-medium">Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.key} className="border-t">
                <td className="py-1">
                  {b.label}
                  {b.kind === "timing" ? " (en camino)" : ""}
                </td>
                <td className="py-1 text-right">
                  {b.kind === "total" ? "" : signedArs(b.value, false)}
                </td>
                <td className="py-1 text-right">{formatMetric("ars", b.to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
