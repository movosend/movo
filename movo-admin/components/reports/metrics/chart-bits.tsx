import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { DISTANCE_BANDS } from "@movo/shared/src/types/admin-reports"
import { dimensionKeys } from "@/lib/reports/catalog"
import type { Delta } from "@/lib/reports/format"
import { cn } from "@/lib/utils"

/** Tramos de distancia: tinta, gris medio y gris claro (los tres pasan 3:1 sobre la tarjeta). */
const BAND_SLOTS = [1, 3, 4]

function slotOf(dimension: string, key: string): number | null {
  if (key === "other") return null
  if (dimension === "band") {
    const i = (DISTANCE_BANDS as readonly string[]).indexOf(key)
    return i >= 0 ? BAND_SLOTS[i] : null
  }
  const i = dimensionKeys(dimension)
    .filter((k) => k !== "other")
    .indexOf(key)
  return i >= 0 && i < 5 ? i + 1 : null
}

/**
 * Color de una fila de desglose, en la escala de tinta del sistema (`--viz-1..5`). Sigue a la entidad,
 * no a su posición: los tramos de distancia y cada motivo tienen siempre el mismo. "Otro" va en el borde.
 */
export function seriesColor(dimension: string, key: string): string {
  const slot = slotOf(dimension, key)
  return slot ? `var(--viz-${slot})` : "var(--border-strong)"
}

/** Texto que se lee encima de `seriesColor`. */
export function seriesInk(dimension: string, key: string): string {
  const slot = slotOf(dimension, key)
  return slot ? `var(--viz-on-${slot})` : "var(--foreground)"
}

const DELTA_CHIP: Record<Delta["tone"], string> = {
  good: "bg-success-soft text-success-fg",
  bad: "bg-danger-soft text-danger-fg",
  flat: "bg-muted text-muted-foreground",
}

/** "+4,2 %" con flecha, en una pastilla del tono de la variación (el texto nunca va solo en color). */
export function DeltaChip({
  delta,
  className,
}: {
  delta: Delta
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-0.5 rounded-full px-2 text-xs font-semibold whitespace-nowrap tabular-nums",
        DELTA_CHIP[delta.tone],
        className
      )}
    >
      {delta.dir > 0 && <ArrowUpRight className="size-3" />}
      {delta.dir < 0 && <ArrowDownRight className="size-3" />}
      {delta.text}
    </span>
  )
}

/** Tendencia mínima de una tarjeta: el período (sólido) sobre el anterior (tenue). Sin ejes. */
export function Sparkline({
  values,
  previous,
  className,
}: {
  values: (number | null)[]
  previous: (number | null)[]
  className?: string
}) {
  const W = 120
  const H = 32
  const known = [...values, ...previous].filter((v): v is number => v != null)
  if (known.length < 2) return <div className={cn("h-8", className)} />
  const max = Math.max(...known)
  const min = Math.min(...known)
  const span = max - min || 1
  const n = Math.max(values.length, 2)
  const x = (j: number) => (j / (n - 1)) * W
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4)
  const path = (vs: (number | null)[]) => {
    let d = ""
    let pen = false
    vs.forEach((v, j) => {
      if (v == null) {
        pen = false
        return
      }
      d += `${pen ? "L" : "M"}${x(j).toFixed(1)} ${y(v).toFixed(1)} `
      pen = true
    })
    return d.trim()
  }
  const lastIdx = values.findLastIndex((v) => v != null)
  return (
    <div className={cn("relative h-8 w-full", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden
        className="block size-full overflow-visible"
      >
        <path
          d={path(previous)}
          fill="none"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          className="stroke-border-strong"
        />
        <path
          d={path(values)}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="stroke-foreground"
        />
      </svg>
      {/* El punto va fuera del SVG: con preserveAspectRatio="none" un círculo se estira. */}
      {lastIdx >= 0 && (
        <span
          aria-hidden
          style={{
            left: `${(x(lastIdx) / W) * 100}%`,
            top: `${(y(values[lastIdx]!) / H) * 100}%`,
          }}
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-foreground bg-lime"
        />
      )}
    </div>
  )
}
