import type {
  DistanceBand,
  ReportGranularity,
  ReportRange,
} from "@movo/shared/src/types/admin-reports"

/** Unidad de una métrica: define el formato, el redondeo y cómo se lee la variación. */
export type MetricUnit =
  | "n"
  | "ars"
  | "pct"
  | "min"
  | "h"
  | "km"
  | "idx"
  /** Envíos por transportista (la relación oferta/demanda del pricing). */
  | "ratio"

/** Las que varían en puntos (pp, pts) y no en % relativo. */
export const isPointUnit = (unit: MetricUnit) =>
  unit === "pct" || unit === "idx"

export const UNIT_SHORT: Record<MetricUnit, string> = {
  n: "cant.",
  ars: "ARS",
  pct: "%",
  min: "min",
  h: "h",
  km: "km",
  idx: "índice",
  ratio: "×",
}

const nf = (v: number, digits: number) =>
  v.toLocaleString("es-AR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

/** `compact` abrevia ("$2,5 M", "$302 mil", "12,3 mil") para tarjetas y ejes. */
export function formatMetric(
  unit: MetricUnit,
  v: number | null | undefined,
  compact = false
): string {
  if (v == null || Number.isNaN(v)) return "—"
  switch (unit) {
    case "ars":
      if (compact && Math.abs(v) >= 1e6) return `$${nf(v / 1e6, 1)} M`
      if (compact && Math.abs(v) >= 1e4) return `$${nf(v / 1e3, 0)} mil`
      return `$${nf(v, 0)}`
    case "pct":
      return `${nf(v, 1)} %`
    case "min":
      return `${nf(v, v < 10 ? 1 : 0)} min`
    case "h":
      return `${nf(v, 1)} h`
    case "km":
      return `${nf(v, 0)} km`
    case "idx":
      return nf(v, 1)
    case "ratio":
      return `${nf(v, 2)}×`
    default:
      if (compact && Math.abs(v) >= 1e4) return `${nf(v / 1e3, 1)} mil`
      return nf(v, Number.isInteger(v) ? 0 : 1)
  }
}

export type DeltaTone = "good" | "bad" | "flat"

export interface Delta {
  /** "+4,2 %", "−1,3 pp" o "—". */
  text: string
  tone: DeltaTone
  /** 1 sube, -1 baja, 0 sin cambio relevante (menos del 1 % relativo). */
  dir: -1 | 0 | 1
}

/**
 * Variación contra el período anterior: en puntos porcentuales para porcentajes (puntos para un
 * índice) y en % relativo para
 * el resto (la misma regla que la columna `change` del CSV). Si "más" es bueno lo dice `good`.
 */
export function deltaOf(
  unit: MetricUnit,
  good: "up" | "down",
  cur: number | null,
  prev: number | null
): Delta {
  if (cur == null || prev == null || prev === 0)
    return { text: "—", tone: "flat", dir: 0 }
  const d = isPointUnit(unit) ? cur - prev : ((cur - prev) / prev) * 100
  const rel = (cur - prev) / prev
  const sign = d > 0 ? "+" : d < 0 ? "−" : ""
  const suffix = unit === "pct" ? "pp" : unit === "idx" ? "pts" : "%"
  const text = `${sign}${nf(Math.abs(d), 1)} ${suffix}`
  if (Math.abs(rel) < 0.01) return { text, tone: "flat", dir: 0 }
  const up = d > 0
  return {
    text,
    tone: up === (good === "up") ? "good" : "bad",
    dir: up ? 1 : -1,
  }
}

export const DELTA_CLASS: Record<DeltaTone, string> = {
  good: "text-success-fg",
  bad: "text-danger-fg",
  flat: "text-muted-foreground",
}

/** Tope "lindo" del eje Y (1, 2, 2,5, 5, 10 × 10ⁿ). */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1
  const e = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / e
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e
}

const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
]
const MONTHS_LONG = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
]
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]

const parts = (day: string) => {
  const date = new Date(`${day}T12:00:00Z`)
  return {
    d: date.getUTCDate(),
    m: date.getUTCMonth(),
    y: date.getUTCFullYear(),
    w: date.getUTCDay(),
  }
}

/** "3 nov". */
export function shortDay(day: string): string {
  const p = parts(day)
  return `${p.d} ${MONTHS[p.m]}`
}

export const monthName = (monthIndex: number) => MONTHS_LONG[monthIndex]

/** "3 nov – 9 nov 2026" (año del final). */
export function rangeLabel(range: ReportRange, withYear = true): string {
  const label = `${shortDay(range.from)} – ${shortDay(range.to)}`
  return withYear ? `${label} ${parts(range.to).y}` : label
}

/** Etiqueta corta del bucket (eje X) y larga (tooltip y CSV). */
export function bucketLabels(
  bucket: { start: string; end: string },
  granularity: ReportGranularity
): { short: string; long: string } {
  const s = parts(bucket.start)
  if (granularity === "day")
    return {
      short: shortDay(bucket.start),
      long: `${WEEKDAYS[s.w]} ${shortDay(bucket.start)}`,
    }
  if (granularity === "week")
    return {
      short: shortDay(bucket.start),
      long: `${shortDay(bucket.start)} – ${shortDay(bucket.end)}`,
    }
  return { short: MONTHS[s.m], long: `${MONTHS_LONG[s.m]} ${s.y}` }
}

export const GRANULARITY_LABEL: Record<ReportGranularity, string> = {
  day: "por día",
  week: "por semana",
  month: "por mes",
}

export const BAND_LABEL: Record<DistanceBand, string> = {
  "50_200": "Hasta 200 km",
  "200_500": "200–500 km",
  "500_plus": "500+ km",
}

/** "hace 14 min", "26 h", "3 d": la antigüedad de lo más viejo de una bandeja. */
export function ageShort(iso: string | null, now: Date): string {
  if (!iso) return "—"
  const min = Math.max(
    0,
    Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)
  )
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.floor(h / 24)} d`
}

/** "+2", "−4", "igual" o `null` (sin dato de ayer). */
export function vsYesterday(
  count: number,
  yesterday: number | null
): string | null {
  if (yesterday == null) return null
  const d = count - yesterday
  if (d === 0) return "igual"
  return d > 0 ? `+${d}` : `−${Math.abs(d)}`
}

/** "+$12 mil", "−$3.400": un monto con signo (cascadas). */
export function signedArs(v: number, compact = true): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : ""
  return `${sign}${formatMetric("ars", Math.abs(v), compact)}`
}

/** Etiqueta de eje en ARS: como la compacta, pero con dos decimales en millones si hacen falta ($1,75 M). */
export function axisArs(v: number): string {
  if (Math.abs(v) >= 1e6 && Math.round(v / 1e4) % 10)
    return `$${nf(v / 1e6, 2)} M`
  return formatMetric("ars", v, true)
}
