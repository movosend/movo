import { describe, expect, it } from "vitest"
import {
  agoLabel,
  boundsOf,
  decodePolyline,
  distanceMeters,
  kmLabel,
  remainingRoute,
  type LatLng,
} from "./geometry"

describe("decodePolyline", () => {
  it("decodifica el ejemplo de la documentación de Google", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ])
  })
  it("devuelve vacío para un string vacío", () => {
    expect(decodePolyline("")).toEqual([])
  })
})

describe("remainingRoute", () => {
  const route: LatLng[] = [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ]
  it("arranca en la posición y sigue desde el vértice más cercano", () => {
    expect(remainingRoute(route, [0.01, 1.1])).toEqual([
      [0.01, 1.1],
      [0, 2],
      [0, 3],
    ])
  })
  it("sin posición devuelve la ruta entera", () => {
    expect(remainingRoute(route, null)).toEqual(route)
  })
  it("sin ruta devuelve vacío", () => {
    expect(remainingRoute([], [0, 0])).toEqual([])
  })
})

describe("boundsOf / distanceMeters / formatos", () => {
  it("calcula los límites de varias listas", () => {
    expect(boundsOf([[1, 5]], [[3, 2]])).toEqual([
      [1, 2],
      [3, 5],
    ])
    expect(boundsOf([])).toBeNull()
  })
  it("mide ~111 km por grado de latitud", () => {
    expect(Math.round(distanceMeters([0, 0], [1, 0]) / 1000)).toBe(111)
  })
  it("formatea el último ping contra la hora del servidor", () => {
    const now = "2026-10-22T12:00:00Z"
    expect(agoLabel("2026-10-22T11:59:57Z", now)).toBe("hace 3 s")
    expect(agoLabel("2026-10-22T11:46:00Z", now)).toBe("hace 14 min")
    expect(agoLabel("2026-10-22T09:00:00Z", now)).toBe("hace 3 h")
    expect(agoLabel(null, now)).toBe("—")
  })
  it("formatea km con coma", () => {
    expect(kmLabel(4230)).toBe("4,2 km")
    expect(kmLabel(null)).toBe("—")
  })
})
