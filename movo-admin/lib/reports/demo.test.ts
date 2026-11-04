import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
import { ADMIN_REPORT_IDS } from "@movo/shared/src/types/admin-reports"
import { demoExportReport, demoReport } from "./mock"

const query = { from: "2026-10-03", to: "2026-11-01" }

describe("datos de demostración de Métricas", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("andan en producción y sin el modo fixtures, sin fallas simuladas", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MOVO_ADMIN_MOCK", "")
    vi.stubEnv("MOVO_ADMIN_MOCK_FAIL", "report!,export!")
    for (const id of ADMIN_REPORT_IDS) {
      const report = demoReport(id, query)
      expect(report.meta.range).toEqual(query)
    }
    expect(
      demoExportReport("cashflow", query, "trend.gmv").rows
    ).toBeGreaterThan(0)
  })

  it("las cascadas de Precio y volumen cierran exacto", () => {
    const { bridge, leakage } = demoReport("pricing", query)
    expect(bridge).not.toBeNull()
    const price = bridge!.price.reduce((a, p) => a + p.amount, 0)
    expect(bridge!.previous + bridge!.volume + bridge!.mix + price).toBe(
      bridge!.current
    )
    const lost = (k: "gmvArs" | "commissionArs") =>
      leakage!.steps.reduce((a, s) => a + s[k], 0)
    expect(leakage!.quoted.gmvArs - lost("gmvArs")).toBe(
      leakage!.captured.gmvArs
    )
    expect(leakage!.quoted.commissionArs - lost("commissionArs")).toBe(
      leakage!.captured.commissionArs
    )
  })

  it("el embudo de Disputas va anidado y Transportistas trae oferta por bucket", () => {
    const { funnel } = demoReport("disputes", query)
    const counts = funnel!.map((s) => s.count)
    expect(counts[0]).toBeGreaterThanOrEqual(counts[1])
    expect(counts[1]).toBeGreaterThanOrEqual(counts[2])
    const carriers = demoReport("carriers", query)
    expect(carriers.supply).toHaveLength(carriers.series.activeCarriers.length)
  })

  it("el CSV de demostración lo dice en el nombre", () => {
    expect(demoExportReport("pricing", query, "bridge").filename).toMatch(
      /^movo-demo-pricing-bridge_/
    )
  })
})
