import { describe, expect, it } from "vitest"
import { DisputeReason, DisputeStatus } from "@movo/shared/src/types/dispute"
import {
  disputeGatewayQuery,
  disputeListHref,
  EMPTY_DISPUTE_STATE,
  nextDisputePage,
  parseDisputeState,
  prevDisputePage,
  withDisputeFilter,
} from "./params"

describe("parseDisputeState", () => {
  it("abiertas por defecto y descarta valores inválidos", () => {
    expect(parseDisputeState({})).toEqual(EMPTY_DISPUTE_STATE)
    const state = parseDisputeState({
      status: "borrar",
      reason: "otra",
      from: "2026-02-30",
      cursor: "no valido!",
    })
    expect(state.status).toBe(DisputeStatus.OPEN)
    expect(state.reason).toBeNull()
    expect(state.from).toBe("")
    expect(state.cursor).toBeNull()
  })

  it("la ciudad vive en la URL junto al resto de los filtros", () => {
    const state = parseDisputeState({
      status: "resolved",
      reason: "damaged",
      city: " Córdoba ",
      q: "Díaz",
    })
    expect(state).toMatchObject({
      status: DisputeStatus.RESOLVED,
      reason: DisputeReason.DAMAGED,
      city: "Córdoba",
      q: "Díaz",
    })
    expect(
      parseDisputeState(
        Object.fromEntries(
          new URLSearchParams(disputeListHref(state).split("?")[1])
        )
      )
    ).toEqual(state)
  })
})

describe("paginado y filtros", () => {
  it("cambiar un filtro vuelve a la primera página", () => {
    const paged = nextDisputePage(EMPTY_DISPUTE_STATE, "o25")
    expect(withDisputeFilter(paged, { city: "Villa María" })).toMatchObject({
      cursor: null,
      back: [],
      city: "Villa María",
    })
  })

  it("anterior vuelve por la pila de cursores", () => {
    const p2 = nextDisputePage(EMPTY_DISPUTE_STATE, "o25")
    const p3 = nextDisputePage(p2, "o50")
    expect(prevDisputePage(p3).cursor).toBe("o25")
    expect(prevDisputePage(prevDisputePage(p3)).cursor).toBeNull()
  })

  it("la query del gateway pide la más antigua primero y manda la ciudad", () => {
    const query = disputeGatewayQuery(
      { ...EMPTY_DISPUTE_STATE, city: "Córdoba", from: "2026-10-01" },
      25
    )
    expect(query.get("sort")).toBe("oldest")
    expect(query.get("status")).toBe("open")
    expect(query.get("city")).toBe("Córdoba")
    expect(query.get("from")).toBe("2026-10-01T03:00:00.000Z")
  })
})
