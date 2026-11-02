import {
  REPORT_GRANULARITY_LIMITS,
  REPORT_RANGE_MAX_DAYS,
  type ReportGranularity,
  type ReportRange,
} from "@movo/shared/src/types/admin-reports"

/**
 * Cuentas de días argentinos `YYYY-MM-DD` (MOVO-345). Se opera en UTC sobre la fecha sola, así un
 * cambio de horario no corre un día. El backend repite la misma regla (MOVO-342); el panel la usa
 * para resolver los atajos y para el modo fixtures.
 */
export type RangePreset = "7d" | "30d" | "90d" | "prev" | "custom"
export const RANGE_PRESETS: readonly RangePreset[] = [
  "7d",
  "30d",
  "90d",
  "prev",
  "custom",
]
export const DEFAULT_PRESET: RangePreset = "30d"

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MS_DAY = 86_400_000

const toUtc = (day: string) =>
  Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false
  return fromUtc(toUtc(value)) === value
}

export const addDays = (day: string, n: number) =>
  fromUtc(toUtc(day) + n * MS_DAY)

/** Días entre `a` y `b` (`b - a`). */
export const diffDays = (a: string, b: string) =>
  Math.round((toUtc(b) - toUtc(a)) / MS_DAY)

/** Largo del rango en días, los dos extremos incluidos. */
export const rangeLength = (range: ReportRange) =>
  diffDays(range.from, range.to) + 1

/** Mismo largo, inmediatamente antes. */
export function previousRange(range: ReportRange): ReportRange {
  const len = rangeLength(range)
  return { from: addDays(range.from, -len), to: addDays(range.to, -len) }
}

export function granularityOf(range: ReportRange): ReportGranularity {
  const len = rangeLength(range)
  if (len <= REPORT_GRANULARITY_LIMITS.day) return "day"
  if (len <= REPORT_GRANULARITY_LIMITS.week) return "week"
  return "month"
}

/** Mes calendario anterior al de `today`. */
function previousMonth(today: string): ReportRange {
  const y = +today.slice(0, 4)
  const m = +today.slice(5, 7) - 1
  const first = fromUtc(Date.UTC(y, m - 1, 1))
  const last = fromUtc(Date.UTC(y, m, 0))
  return { from: first, to: last }
}

/**
 * Atajo → rango. `custom` se acota a [hoy − 365, hoy] y se ordena; sin fechas válidas cae a 30 días.
 */
export function resolveRange(
  preset: RangePreset,
  today: string,
  custom: { from?: string | null; to?: string | null } = {}
): ReportRange {
  if (preset === "prev") return previousMonth(today)
  if (preset === "custom") {
    const min = addDays(today, -(REPORT_RANGE_MAX_DAYS - 1))
    const clamp = (d: string) => (d < min ? min : d > today ? today : d)
    if (!isDay(custom.from) || !isDay(custom.to))
      return resolveRange(DEFAULT_PRESET, today)
    let from = clamp(custom.from)
    let to = clamp(custom.to)
    if (from > to) [from, to] = [to, from]
    return { from, to }
  }
  const n = preset === "7d" ? 7 : preset === "90d" ? 90 : 30
  return { from: addDays(today, -(n - 1)), to: today }
}

export interface Bucket {
  start: string
  end: string
}

/**
 * Buckets de la serie. Por semana se cortan de a 7 desde el final (la última semana es la completa
 * más reciente; la primera puede quedar corta); por mes, meses calendario recortados al rango.
 */
export function bucketsOf(
  range: ReportRange,
  granularity = granularityOf(range)
): Bucket[] {
  const out: Bucket[] = []
  if (granularity === "day") {
    for (let d = range.from; d <= range.to; d = addDays(d, 1))
      out.push({ start: d, end: d })
    return out
  }
  if (granularity === "week") {
    for (let end = range.to; end >= range.from; end = addDays(end, -7)) {
      const start = addDays(end, -6)
      out.unshift({ start: start < range.from ? range.from : start, end })
    }
    return out
  }
  let start = range.from
  while (start <= range.to) {
    const y = +start.slice(0, 4)
    const m = +start.slice(5, 7) - 1
    const monthEnd = fromUtc(Date.UTC(y, m + 1, 0))
    const end = monthEnd > range.to ? range.to : monthEnd
    out.push({ start, end })
    start = addDays(end, 1)
  }
  return out
}

/** Todos los días del rango. */
export function daysOf(range: ReportRange): string[] {
  const out: string[] = []
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(d)
  return out
}
