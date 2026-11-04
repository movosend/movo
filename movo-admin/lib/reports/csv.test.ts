import { describe, expect, it } from "vitest"
import type { DisputesReport } from "@movo/shared/src/types/admin-reports"
import { changeOf, csvCell, reportSectionCsv, UnknownSectionError } from "./csv"

const report: DisputesReport = {
  funnel: null,
  backlog: [],
  meta: {
    range: { from: "2026-10-30", to: "2026-11-01" },
    previous: { from: "2026-10-27", to: "2026-10-29" },
    granularity: "day",
    band: null,
    bandApplied: true,
    generatedAt: "2026-11-01T12:00:00Z",
  },
  kpis: {
    opened: { value: 6, previous: 4 },
    resolved: { value: 3, previous: 3 },
    resolutionHours: { value: 30.5, previous: 40 },
    disputeRate: { value: 1.6, previous: 2.1 },
    senderAmountArs: { value: 0, previous: 0 },
    carrierAmountArs: { value: 0, previous: 0 },
  },
  series: {
    opened: [
      { start: "2026-10-30", end: "2026-10-30", value: 2, previous: 1 },
      { start: "2026-10-31", end: "2026-10-31", value: 0, previous: 2 },
      { start: "2026-11-01", end: "2026-11-01", value: 4, previous: 1 },
    ],
    resolved: [],
    resolutionHours: [],
    senderAmountArs: [],
    carrierAmountArs: [],
    disputeRate: [
      { start: "2026-10-30", end: "2026-10-30", value: 1.2, previous: 2.0 },
      { start: "2026-10-31", end: "2026-10-31", value: null, previous: 2.2 },
      { start: "2026-11-01", end: "2026-11-01", value: 2.0, previous: 2.1 },
    ],
  },
  breakdowns: [
    {
      dimension: "reason",
      metric: "opened",
      total: { value: 6, previous: 4 },
      rows: [
        { key: "damaged", value: 4, previous: 2, share: 66.7 },
        { key: '=HYPERLINK("x")', value: 2, previous: 2, share: 33.3 },
      ],
    },
  ],
}

const parse = (csv: string) =>
  csv
    .replace(/^﻿/, "")
    .trim()
    .split("\n")
    .map((l) => l.split(","))

describe("CSV de los reportes", () => {
  it("neutraliza fórmulas y escapa comas y comillas", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)")
    expect(csvCell("@cmd")).toBe("'@cmd")
    expect(csvCell("Rosario, Santa Fe")).toBe('"Rosario, Santa Fe"')
    expect(csvCell(-12.5)).toBe("-12.5")
    expect(csvCell(null)).toBe("")
  })

  it("la tendencia trae las mismas filas que el gráfico más el total del KPI", () => {
    const { csv, rows } = reportSectionCsv("disputes", report, "trend.opened")
    const lines = parse(csv)
    expect(lines[0]).toEqual([
      "period_start",
      "period_end",
      "value",
      "previous",
      "change",
    ])
    expect(rows).toBe(report.series.opened.length + 1)
    expect(lines.slice(1, -1).map((l) => Number(l[2]))).toEqual(
      report.series.opened.map((p) => p.value)
    )
    expect(lines.at(-1)).toEqual(["Total", "", "6", "4", "50"])
  })

  it("en porcentajes la variación va en puntos y un bucket sin dato queda vacío", () => {
    const lines = parse(
      reportSectionCsv("disputes", report, "trend.disputeRate").csv
    )
    expect(lines[1][4]).toBe("-0.8")
    expect(lines[2][2]).toBe("")
    expect(changeOf(true, { value: 1.6, previous: 2.1 })).toBe(-0.5)
  })

  it("el desglose suma su total y no deja pasar una fórmula en la clave", () => {
    const { csv } = reportSectionCsv("disputes", report, "breakdown.reason")
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(parse(csv).at(-1)?.slice(0, 3)).toEqual(["Total", "6", "100"])
  })

  it("una sección que no existe es un error, no un CSV vacío", () => {
    expect(() =>
      reportSectionCsv("disputes", report, "breakdown.band")
    ).toThrow(UnknownSectionError)
    expect(() => reportSectionCsv("disputes", report, "scorecard")).toThrow(
      UnknownSectionError
    )
  })
})
