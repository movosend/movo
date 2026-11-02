import { describe, expect, it } from "vitest"
import type {
  CaptureLeakage,
  GmvBridge,
  PricingReport,
} from "@movo/shared/src/types/admin-reports"
import { reportSectionCsv } from "./csv"
import { bridgeBars, leakageBars, waterfallDomain } from "./waterfall"

const bridge: GmvBridge = {
  previous: 2_400_000,
  current: 2_520_000,
  volume: 90_000,
  mix: 12_000,
  price: [
    { key: "fuel", amount: 30_000 },
    { key: "demand", amount: -5_000 },
    { key: "algorithm", amount: 0 },
    { key: "negotiation", amount: -9_000 },
    { key: "other", amount: 2_000 },
  ],
}

const leakage: CaptureLeakage = {
  quoted: { shipments: 300, gmvArs: 3_000_000, commissionArs: 360_000 },
  steps: [
    {
      key: "unassigned",
      timing: false,
      shipments: 30,
      gmvArs: 300_000,
      commissionArs: 36_000,
    },
    {
      key: "cash_commission_debt",
      timing: false,
      shipments: 4,
      gmvArs: 0,
      commissionArs: 5_000,
    },
    {
      key: "in_flight",
      timing: true,
      shipments: 20,
      gmvArs: 200_000,
      commissionArs: 24_000,
    },
  ],
  captured: { shipments: 250, gmvArs: 2_500_000, commissionArs: 295_000 },
}

describe("bridgeBars", () => {
  it("cierra en el total actual y salta los componentes en cero", () => {
    const { bars, groups } = bridgeBars(bridge)
    expect(bars.map((b) => b.key)).toEqual([
      "previous",
      "volume",
      "mix",
      "fuel",
      "demand",
      "negotiation",
      "other",
      "current",
    ])
    expect(bars.at(-1)!.value).toBe(bridge.current)
    expect(bars[1]).toMatchObject({
      kind: "up",
      from: 2_400_000,
      to: 2_490_000,
    })
    expect(bars[4].kind).toBe("down")
    expect(groups).toEqual([
      { first: 3, last: 6, label: "Efecto precio", value: 18_000 },
    ])
  })
})

describe("leakageBars", () => {
  it("resta hasta lo capturado; lo que está en camino va aparte", () => {
    const gmv = leakageBars(leakage, "gmv")
    // La comisión en efectivo no resta GMV: no aparece.
    expect(gmv.map((b) => b.key)).toEqual([
      "quoted",
      "unassigned",
      "in_flight",
      "captured",
    ])
    expect(gmv.at(-1)!.value).toBe(leakage.captured.gmvArs)
    expect(gmv[2]).toMatchObject({ kind: "timing", value: -200_000 })
  })

  it("en comisión cierra en la comisión capturada", () => {
    const bars = leakageBars(leakage, "commission")
    expect(bars.map((b) => b.key)).toContain("cash_commission_debt")
    expect(bars.at(-1)!.value).toBe(leakage.captured.commissionArs)
  })
})

describe("waterfallDomain", () => {
  it("corta el eje si los pasos son chicos al lado de los totales", () => {
    const d = waterfallDomain(bridgeBars(bridge).bars)
    expect(d.cut).toBe(true)
    expect(d.lo).toBeGreaterThan(0)
    expect(d.lo).toBeLessThanOrEqual(2_400_000)
    expect(d.hi).toBeGreaterThanOrEqual(2_520_000)
  })

  it("arranca en cero si los pasos son grandes", () => {
    const big = {
      ...leakage,
      steps: [{ ...leakage.steps[0], gmvArs: 2_000_000 }],
    }
    const d = waterfallDomain(leakageBars(big, "gmv"))
    expect(d).toMatchObject({ lo: 0, cut: false })
  })
})

describe("CSV de Precio y volumen", () => {
  const report = {
    meta: {
      range: { from: "2026-10-03", to: "2026-11-01" },
      previous: { from: "2026-09-03", to: "2026-10-02" },
      granularity: "day",
      band: null,
      bandApplied: true,
      generatedAt: "2026-11-01T12:00:00Z",
    },
    kpis: {},
    series: {},
    breakdowns: [],
    bridge,
    leakage,
  } as unknown as PricingReport

  it("bridge: paso, monto y acumulado", () => {
    const { csv, rows } = reportSectionCsv("pricing", report, "bridge")
    const lines = csv.trim().split("\n")
    expect(lines[0]).toBe("step,amount_ars,cumulative_ars")
    expect(lines[1]).toBe("previous,2400000,2400000")
    expect(lines.at(-1)).toBe("current,2520000,2520000")
    expect(rows).toBe(8)
  })

  it("leakage: cotizado, pasos y capturado con su participación", () => {
    const { csv } = reportSectionCsv("pricing", report, "leakage")
    const lines = csv.trim().split("\n")
    expect(lines[1]).toBe("quoted,,300,3000000,360000,100")
    expect(lines[2]).toBe("unassigned,no,30,300000,36000,10")
    expect(lines.at(-1)).toBe("captured,,250,2500000,295000,83.3")
  })
})
