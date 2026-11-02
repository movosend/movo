import { describe, expect, it } from "vitest"
import {
  bucketsOf,
  granularityOf,
  isDay,
  previousRange,
  rangeLength,
  resolveRange,
} from "./range"

const TODAY = "2026-11-01"

describe("resolveRange", () => {
  it("resuelve los atajos con hoy incluido", () => {
    expect(resolveRange("7d", TODAY)).toEqual({ from: "2026-10-26", to: TODAY })
    expect(resolveRange("30d", TODAY)).toEqual({
      from: "2026-10-03",
      to: TODAY,
    })
    expect(rangeLength(resolveRange("90d", TODAY))).toBe(90)
  })

  it("el mes anterior es el calendario, también en enero", () => {
    expect(resolveRange("prev", TODAY)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    })
    expect(resolveRange("prev", "2027-01-15")).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    })
  })

  it("acota el personalizado a un año hacia atrás y a hoy, y ordena las fechas", () => {
    expect(
      resolveRange("custom", TODAY, { from: "2026-10-20", to: "2026-10-10" })
    ).toEqual({ from: "2026-10-10", to: "2026-10-20" })
    expect(
      resolveRange("custom", TODAY, { from: "2020-01-01", to: "2030-01-01" })
    ).toEqual({ from: "2025-11-01", to: TODAY })
  })

  it("un personalizado inválido cae a 30 días", () => {
    expect(
      resolveRange("custom", TODAY, { from: "2026-02-30", to: TODAY })
    ).toEqual(resolveRange("30d", TODAY))
    expect(isDay("2026-02-30")).toBe(false)
  })
})

describe("período anterior y granularidad", () => {
  it("el anterior tiene el mismo largo e inmediatamente antes", () => {
    expect(previousRange({ from: "2026-10-26", to: "2026-11-01" })).toEqual({
      from: "2026-10-19",
      to: "2026-10-25",
    })
  })

  it("día hasta 31, semana hasta 120, mes el resto", () => {
    expect(granularityOf(resolveRange("30d", TODAY))).toBe("day")
    expect(granularityOf({ from: "2026-10-01", to: "2026-10-31" })).toBe("day")
    expect(granularityOf(resolveRange("90d", TODAY))).toBe("week")
    expect(granularityOf({ from: "2026-01-01", to: TODAY })).toBe("month")
  })

  it("las semanas se cortan desde el final y cubren el rango sin solaparse", () => {
    const range = { from: "2026-10-01", to: "2026-11-01" }
    const weeks = bucketsOf(range, "week")
    expect(weeks.at(-1)).toEqual({ start: "2026-10-26", end: TODAY })
    expect(weeks[0].start).toBe("2026-10-01")
    expect(
      weeks.reduce((a, w) => a + rangeLength({ from: w.start, to: w.end }), 0)
    ).toBe(rangeLength(range))
  })

  it("los meses se recortan al rango", () => {
    expect(
      bucketsOf({ from: "2026-09-15", to: "2026-11-01" }, "month")
    ).toEqual([
      { start: "2026-09-15", end: "2026-09-30" },
      { start: "2026-10-01", end: "2026-10-31" },
      { start: "2026-11-01", end: "2026-11-01" },
    ])
  })
})
