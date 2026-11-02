import { describe, expect, it } from "vitest"
import { ageShort, deltaOf, formatMetric, niceMax, vsYesterday } from "./format"

describe("deltaOf", () => {
  it("los porcentajes varían en puntos, el resto en % relativo", () => {
    expect(deltaOf("pct", "up", 87, 84).text).toBe("+3,0 pp")
    expect(deltaOf("n", "up", 110, 100).text).toBe("+10,0 %")
  })

  it("el tono depende de si más es mejor", () => {
    expect(deltaOf("h", "down", 20, 25).tone).toBe("good")
    expect(deltaOf("h", "down", 25, 20).tone).toBe("bad")
    expect(deltaOf("ars", "up", 100.5, 100).tone).toBe("flat")
  })

  it("sin base de comparación no inventa una variación", () => {
    expect(deltaOf("n", "up", 5, 0)).toEqual({
      text: "—",
      tone: "flat",
      dir: 0,
    })
    expect(deltaOf("n", "up", null, 3).text).toBe("—")
  })
})

describe("formatMetric", () => {
  it("abrevia montos en las tarjetas", () => {
    expect(formatMetric("ars", 2_520_000, true)).toBe("$2,5 M")
    expect(formatMetric("ars", 302_000, true)).toBe("$302 mil")
    expect(formatMetric("ars", 12_000)).toBe("$12.000")
  })

  it("un dato faltante es una raya, no un cero", () => {
    expect(formatMetric("pct", null)).toBe("—")
  })
})

describe("home", () => {
  it("antigüedad corta y vs ayer", () => {
    const now = new Date("2026-11-01T12:00:00Z")
    expect(ageShort("2026-11-01T11:46:00Z", now)).toBe("14 min")
    expect(ageShort("2026-10-31T10:00:00Z", now)).toBe("26 h")
    expect(ageShort("2026-10-29T10:00:00Z", now)).toBe("3 d")
    expect(vsYesterday(7, 5)).toBe("+2")
    expect(vsYesterday(5, 5)).toBe("igual")
    expect(vsYesterday(5, null)).toBeNull()
  })

  it("niceMax redondea el eje hacia arriba", () => {
    expect(niceMax(87)).toBe(100)
    expect(niceMax(2.1)).toBe(2.5)
  })
})
