import { describe, expect, it } from "vitest"
import {
  auditGatewayQuery,
  auditHref,
  disputeReportHref,
  EMPTY_AUDIT_STATE,
  EMPTY_METRICS_STATE,
  metricsHref,
  metricsRange,
  parseAuditState,
  parseMetricsState,
} from "./params"
import { internalReturnPath } from "@/lib/auth/policy"

const DISPUTE = "0e1d2c3b-4a59-4687-9a6b-5c4d3e2f0142"

describe("estado de Métricas en la URL", () => {
  it("los datos reales son el default: solo `datos=demo` activa la demostración", () => {
    expect(parseMetricsState({}).demo).toBe(false)
    expect(parseMetricsState({ datos: "otra" }).demo).toBe(false)
    expect(metricsHref(EMPTY_METRICS_STATE)).toBe("/metrics")
    expect(metricsHref({ ...EMPTY_METRICS_STATE, demo: true })).toBe(
      "/metrics?datos=demo"
    )
    expect(internalReturnPath("/metrics?datos=demo")).toBe(
      "/metrics?datos=demo"
    )
  })

  it("ida y vuelta con todos los filtros", () => {
    const href = metricsHref({
      tab: "disputes",
      preset: "custom",
      from: "2026-10-01",
      to: "2026-10-20",
      band: "200_500",
      dispute: DISPUTE,
      demo: true,
    })
    expect(href).toContain("datos=demo")
    const state = parseMetricsState(
      Object.fromEntries(new URL(href, "https://x").searchParams)
    )
    expect(state).toEqual({
      tab: "disputes",
      preset: "custom",
      from: "2026-10-01",
      to: "2026-10-20",
      band: "200_500",
      dispute: DISPUTE,
      demo: true,
    })
    expect(metricsRange(state, "2026-11-01")).toEqual({
      from: "2026-10-01",
      to: "2026-10-20",
    })
  })

  it("valores inválidos caen a los defaults, y el default no ensucia la URL", () => {
    expect(
      parseMetricsState({ tab: "plata", r: "1y", d: "0_50", from: "DSP-1" })
    ).toEqual(EMPTY_METRICS_STATE)
    expect(
      parseMetricsState({
        r: "custom",
        desde: "2026-13-01",
        hasta: "2026-10-01",
      }).preset
    ).toBe("30d")
    expect(metricsHref(EMPTY_METRICS_STATE)).toBe("/metrics")
  })

  it("la disputa de origen solo viaja en la pestaña Disputas", () => {
    expect(
      metricsHref({ ...EMPTY_METRICS_STATE, tab: "cashflow", dispute: DISPUTE })
    ).toBe("/metrics")
    expect(disputeReportHref(DISPUTE)).toBe(
      `/metrics?tab=disputes&r=90d&from=${DISPUTE}`
    )
  })

  it("los destinos de vuelta tras el login aceptan las dos pantallas", () => {
    expect(internalReturnPath(disputeReportHref(DISPUTE))).toBe(
      disputeReportHref(DISPUTE)
    )
    expect(internalReturnPath("/audit-log?target=dispute&view=table")).toBe(
      "/audit-log?target=dispute&view=table"
    )
    expect(internalReturnPath("/metrics/../login")).toBe("/")
  })
})

describe("estado de la Bitácora en la URL", () => {
  it("parsea y arma la query del gateway con los nombres del contrato", () => {
    const state = parseAuditState({
      admin: "3f6c1a52-8e0d-4b7a-9c21-5d4e8f1a2b90",
      action: "dispute.resolve",
      target: "dispute",
      q: " #MOVO-48213 ",
      view: "table",
    })
    expect(state.q).toBe("#MOVO-48213")
    expect(auditGatewayQuery(state, { limit: 20, cursor: "abc" })).toBe(
      "adminId=3f6c1a52-8e0d-4b7a-9c21-5d4e8f1a2b90&action=dispute.resolve&targetType=dispute&targetId=MOVO-48213&limit=20&cursor=abc"
    )
  })

  it("descarta lo que no es válido", () => {
    expect(
      parseAuditState({ admin: "yo", action: "DROP TABLE", target: "planet" })
    ).toEqual(EMPTY_AUDIT_STATE)
    expect(auditHref(EMPTY_AUDIT_STATE)).toBe("/audit-log")
  })

  it("la vista por defecto es la línea de tiempo", () => {
    expect(parseAuditState({}).view).toBe("timeline")
    expect(parseAuditState({ view: "table" }).view).toBe("table")
    expect(auditHref({ ...EMPTY_AUDIT_STATE, view: "table" })).toBe(
      "/audit-log?view=table"
    )
  })
})
