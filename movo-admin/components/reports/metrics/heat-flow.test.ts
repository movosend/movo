import { describe, expect, it } from "vitest"
import { supplyTotals } from "./carriers"
import { funnelSteps } from "./disputes-flow"
import { heatScore } from "./distances"

describe("heatScore", () => {
  it("el mejor tramo da 1 y el peor -1, según si más es mejor", () => {
    const completed = [94, 89, 82]
    expect(heatScore(completed, "up", 94)).toBe(1)
    expect(heatScore(completed, "up", 82)).toBe(-1)
    const hours = [8, 21, 49]
    expect(heatScore(hours, "down", 8)).toBe(1)
    expect(heatScore(hours, "down", 49)).toBe(-1)
  })

  it("sin dato o sin con qué comparar, no colorea", () => {
    expect(heatScore([90, null, null], "up", 90)).toBeNull()
    expect(heatScore([90, 85, 80], "up", null)).toBeNull()
    expect(heatScore([90, 90, 90], "up", 90)).toBe(0)
  })
})

describe("funnelSteps", () => {
  it("conversión sobre la etapa anterior y sobre las abiertas, y cuántas quedaron", () => {
    const steps = funnelSteps([
      { key: "opened", count: 20, previous: 18, medianHoursFromPrevious: null },
      { key: "decided", count: 16, previous: 15, medianHoursFromPrevious: 26 },
      { key: "resolved", count: 12, previous: 12, medianHoursFromPrevious: 7 },
    ])
    expect(steps.map((s) => s.stuck)).toEqual([0, 4, 4])
    expect(steps[1].fromPrevious).toBe(80)
    expect(steps[2].fromPrevious).toBe(75)
    expect(steps[2].fromStart).toBe(60)
  })
})

describe("supplyTotals", () => {
  it("suma publicados y asignados, y la brecha nunca es negativa", () => {
    const t = supplyTotals([
      {
        start: "2026-10-01",
        end: "2026-10-01",
        published: 10,
        assignedWithin24h: 8,
      },
      {
        start: "2026-10-02",
        end: "2026-10-02",
        published: 6,
        assignedWithin24h: null,
      },
      {
        start: "2026-10-03",
        end: "2026-10-03",
        published: 4,
        assignedWithin24h: 4,
      },
    ])
    expect(t).toMatchObject({ published: 20, assigned: 12, gap: 8 })
    expect(t.rate).toBe(60)
  })
})
