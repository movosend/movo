import type {
  AdminReportById,
  AdminReportId,
  DistancesReport,
  PricingReport,
  Report,
  ReportValue,
} from "@movo/shared/src/types/admin-reports"
import { SCORECARD_COLUMNS, metricOf } from "./catalog"
import { isPointUnit } from "./format"
import { bridgeBars } from "./waterfall"

/**
 * El CSV de un reporte, con la convención que propone MOVO-344 para el backend. El panel no lo usa
 * contra datos reales (el CSV lo genera `svc-admin`); lo usan el modo fixtures y los tests, para
 * comprobar que lo exportado coincide con lo que se ve.
 */

/** Una celda que arranca con `= + - @` (o tab/CR) se prefija con `'`: no la interpreta una planilla. */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return ""
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : ""
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export const csvLine = (cells: (string | number | null | undefined)[]) =>
  cells.map(csvCell).join(",")

/** BOM para que Excel lo abra en UTF-8 (tildes). */
export const toCsv = (rows: (string | number | null | undefined)[][]) =>
  `﻿${rows.map(csvLine).join("\n")}\n`

const round1 = (v: number) => Math.round(v * 10) / 10

/** `change`: pp si es porcentaje, % relativo si no. Vacío sin base de comparación. */
export function changeOf(pct: boolean, v: ReportValue): number | null {
  if (v.value == null || v.previous == null || v.previous === 0) return null
  return round1(
    pct ? v.value - v.previous : ((v.value - v.previous) / v.previous) * 100
  )
}

export class UnknownSectionError extends Error {}

export function reportSectionCsv<R extends AdminReportId>(
  id: R,
  report: AdminReportById[R],
  section: string
): { csv: string; rows: number } {
  const base = report as Report<string>
  const [kind, key] = section.split(".", 2) as [string, string | undefined]
  if (kind === "trend" && key && base.series[key]) {
    const pct = isPointUnit(metricOf(id, key).unit)
    const body = base.series[key].map((p) => [
      p.start,
      p.end,
      p.value,
      p.previous,
      changeOf(pct, p),
    ])
    const total = base.kpis[key]
    body.push([
      "Total",
      null,
      total.value,
      total.previous,
      changeOf(pct, total),
    ])
    return {
      csv: toCsv([
        ["period_start", "period_end", "value", "previous", "change"],
        ...body,
      ]),
      rows: body.length,
    }
  }
  if (kind === "breakdown" && key) {
    const bd = base.breakdowns.find((b) => b.dimension === key)
    if (!bd) throw new UnknownSectionError(section)
    const meta = metricOf(id, bd.metric)
    const pct = isPointUnit(meta.unit)
    const body = bd.rows.map((r) => [
      r.key,
      r.value,
      r.share,
      r.previous,
      changeOf(pct, r),
    ])
    body.push([
      "Total",
      bd.total.value,
      meta.sums ? 100 : null,
      bd.total.previous,
      changeOf(pct, bd.total),
    ])
    return {
      csv: toCsv([["key", "value", "share", "previous", "change"], ...body]),
      rows: body.length,
    }
  }
  if (id === "distances" && section === "scorecard") {
    const d = report as DistancesReport
    const head = [
      "band",
      ...SCORECARD_COLUMNS.flatMap((c) => [c.key, `${c.key}_change`]),
    ]
    const body = d.scorecard.map((row) => [
      row.band,
      ...SCORECARD_COLUMNS.flatMap((c) => [
        row[c.key].value,
        changeOf(c.unit === "pct", row[c.key]),
      ]),
    ])
    return { csv: toCsv([head, ...body]), rows: body.length }
  }
  if (id === "distances" && section === "corridors") {
    const d = report as DistancesReport
    const head = [
      "origin_city",
      "destination_city",
      "distance_km",
      "band",
      "published",
      "published_previous",
      "change",
      "completion_rate",
    ]
    const body = d.corridors.map((c) => [
      c.originCity,
      c.destinationCity,
      c.distanceKm,
      c.band,
      c.published,
      c.publishedPrevious,
      changeOf(false, { value: c.published, previous: c.publishedPrevious }),
      c.completionRate,
    ])
    return { csv: toCsv([head, ...body]), rows: body.length }
  }
  if (id === "pricing" && section === "bridge") {
    const { bridge } = report as PricingReport
    if (!bridge)
      return { csv: toCsv([["step", "amount_ars", "cumulative_ars"]]), rows: 0 }
    const body = bridgeBars(bridge).bars.map((b) => [b.key, b.value, b.to])
    return {
      csv: toCsv([["step", "amount_ars", "cumulative_ars"], ...body]),
      rows: body.length,
    }
  }
  if (id === "pricing" && section === "leakage") {
    const { leakage } = report as PricingReport
    const head = [
      "step",
      "timing",
      "shipments",
      "gmv_ars",
      "commission_ars",
      "share_of_quoted",
    ]
    if (!leakage) return { csv: toCsv([head]), rows: 0 }
    const share = (v: number) =>
      leakage.quoted.gmvArs ? round1((v / leakage.quoted.gmvArs) * 100) : null
    const row = (
      key: string,
      timing: boolean | null,
      a: { shipments: number; gmvArs: number; commissionArs: number }
    ) => [
      key,
      timing == null ? null : timing ? "yes" : "no",
      a.shipments,
      a.gmvArs,
      a.commissionArs,
      share(a.gmvArs),
    ]
    const body = [
      row("quoted", null, leakage.quoted),
      ...leakage.steps.map((s) => row(s.key, s.timing, s)),
      row("captured", null, leakage.captured),
    ]
    return { csv: toCsv([head, ...body]), rows: body.length }
  }
  throw new UnknownSectionError(section)
}

/** El CSV de datos de demostración lo dice en el nombre: `movo-demo-…`. */
export const demoFileName = (name: string) =>
  name.replace(/^movo-/, "movo-demo-")

/** `movo-disputes-trend-opened_2026-10-03_2026-11-01.csv`. */
export function reportFileName(
  id: AdminReportId,
  section: string,
  range: { from: string; to: string },
  band: string | null
) {
  const part = section.replace(".", "-")
  return `movo-${id}-${part}${band ? `-${band}` : ""}_${range.from}_${range.to}.csv`
}
