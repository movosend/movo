import { describe, expect, it } from "vitest"
import {
  CONTEXT_LIMITS,
  DEFAULT_PANELS,
  LIST_LIMITS,
  clampWidth,
  parsePanels,
  serializePanels,
} from "./panels"

describe("paneles laterales", () => {
  it("sin cookie o con basura usa los valores por defecto", () => {
    expect(parsePanels(undefined)).toEqual(DEFAULT_PANELS)
    expect(parsePanels("%7Bno-json")).toEqual(DEFAULT_PANELS)
    expect(parsePanels(encodeURIComponent('{"list":"ancho"}'))).toEqual(
      DEFAULT_PANELS
    )
  })

  it("ida y vuelta por la cookie", () => {
    const state = {
      list: 400,
      listCollapsed: true,
      context: 300,
      contextCollapsed: false,
    }
    expect(parsePanels(serializePanels(state))).toEqual(state)
  })

  it("acota los anchos a los límites de cada columna", () => {
    expect(clampWidth(10, LIST_LIMITS)).toBe(LIST_LIMITS.min)
    expect(clampWidth(9999, LIST_LIMITS)).toBe(LIST_LIMITS.max)
    const parsed = parsePanels(
      serializePanels({ ...DEFAULT_PANELS, list: 5, context: 5000 })
    )
    expect(parsed.list).toBe(LIST_LIMITS.min)
    expect(parsed.context).toBe(CONTEXT_LIMITS.max)
  })
})
