import { describe, expect, it } from "vitest"
import { internalReturnPath } from "@/lib/auth/policy"
import {
  EMPTY_LIST_STATE,
  gatewayQuery,
  listHref,
  MAX_BACK,
  nextPage,
  pageNumber,
  parseListState,
  prevPage,
  withFilter,
} from "./params"

describe("estado del listado en la URL", () => {
  it("por defecto: todos los activos, primera página", () => {
    expect(parseListState({})).toEqual(EMPTY_LIST_STATE)
    expect(listHref(EMPTY_LIST_STATE)).toBe("/shipments")
  })

  it("ida y vuelta de todos los filtros", () => {
    const href = listHref({
      ...EMPTY_LIST_STATE,
      tab: "assigning",
      status: "assigned_unfunded",
      q: "ana",
      city: "Córdoba",
      from: "2026-10-01",
      to: "2026-10-21",
      alert: true,
    })
    const parsed = parseListState(
      Object.fromEntries(new URLSearchParams(href.split("?")[1]))
    )
    expect(parsed).toMatchObject({
      tab: "assigning",
      status: "assigned_unfunded",
      q: "ana",
      city: "Córdoba",
      from: "2026-10-01",
      to: "2026-10-21",
      alert: true,
    })
    // El detalle puede volver a este listado.
    expect(internalReturnPath(href)).toBe(href)
  })

  it("descarta valores inválidos y un estado de otra pestaña", () => {
    expect(
      parseListState({
        group: "otro",
        status: "in_transit",
        from: "ayer",
        cursor: "../x",
      })
    ).toEqual(EMPTY_LIST_STATE)
    expect(
      parseListState({ group: "closed", status: "in_transit" }).status
    ).toBeNull()
  })

  it("páginas por cursor: siguiente apila, anterior desapila y un filtro vuelve a la primera", () => {
    const p2 = nextPage(EMPTY_LIST_STATE, "c2")
    const p3 = nextPage(p2, "c3")
    expect(p3).toMatchObject({ cursor: "c3", back: ["c2"] })
    expect(prevPage(p3)).toMatchObject({ cursor: "c2", back: [] })
    expect(prevPage(p2)).toMatchObject({ cursor: null, back: [] })
    expect(
      parseListState(
        Object.fromEntries(new URLSearchParams(listHref(p3).split("?")[1]))
      )
    ).toMatchObject({
      cursor: "c3",
      back: ["c2"],
    })
    expect(withFilter(p3, { q: "x" })).toMatchObject({ cursor: null, back: [] })
  })

  it("descarta fechas que no existen en vez de romper la query", () => {
    const state = parseListState({ from: "2026-13-45", to: "2026-02-30" })
    expect(state).toMatchObject({ from: "", to: "" })
    expect(() => gatewayQuery(state, 25)).not.toThrow()
  })

  it("con muchas páginas atrás, `back` se corta y el número de página no se muestra", () => {
    let state = EMPTY_LIST_STATE
    for (let i = 2; i <= MAX_BACK + 3; i++) state = nextPage(state, `c${i}`)
    expect(state.back).toHaveLength(MAX_BACK)
    expect(pageNumber(state)).toBeNull()
    expect(pageNumber(nextPage(nextPage(EMPTY_LIST_STATE, "c2"), "c3"))).toBe(3)
    expect(pageNumber(EMPTY_LIST_STATE)).toBe(1)
  })

  it("al gateway: días argentinos completos y `alert=true`", () => {
    const query = gatewayQuery(
      {
        ...EMPTY_LIST_STATE,
        from: "2026-10-01",
        to: "2026-10-21",
        alert: true,
      },
      25
    )
    expect(query.get("from")).toBe("2026-10-01T03:00:00.000Z")
    expect(query.get("to")).toBe("2026-10-22T02:59:59.999Z")
    expect(query.get("alert")).toBe("true")
    expect(query.get("limit")).toBe("25")
  })
})

describe("internalReturnPath acepta el detalle de un envío", () => {
  it("con y sin el listado de origen", () => {
    const id = "4800bc55-a000-4000-8000-000000048213"
    expect(internalReturnPath(`/shipments/${id}`)).toBe(`/shipments/${id}`)
    const withFrom = `/shipments/${id}?${new URLSearchParams({ from: "group=closed&q=ana" })}`
    expect(internalReturnPath(withFrom)).toBe(withFrom)
    expect(internalReturnPath("/shipments/../admins")).toBe("/")
  })
})
