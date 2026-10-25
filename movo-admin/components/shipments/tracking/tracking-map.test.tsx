import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { trackingFixture } from "./fixtures"

const h = vi.hoisted(() => {
  const chain = () => {
    const o: Record<string, unknown> = {}
    for (const k of ["addTo", "setLatLngs", "setStyle", "setLatLng", "setIcon"])
      o[k] = vi.fn(() => o)
    o.remove = vi.fn()
    return o
  }
  const map = {
    attributionControl: { setPrefix: vi.fn() },
    setView: vi.fn(),
    fitBounds: vi.fn(),
    panTo: vi.fn(),
    invalidateSize: vi.fn(),
    remove: vi.fn(),
  }
  const lib = {
    map: vi.fn(() => map),
    control: { zoom: vi.fn(() => chain()) },
    polyline: vi.fn(() => chain()),
    marker: vi.fn(() => chain()),
    divIcon: vi.fn((o: unknown) => o),
  }
  const maplibreGL = vi.fn(
    (o: unknown) => (void o, Object.assign(chain(), { options: {} }))
  )
  return { map, lib, maplibreGL }
})

vi.mock("leaflet", () => ({ default: h.lib }))
vi.mock("leaflet/dist/leaflet.css", () => ({}))
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}))
vi.mock("@maplibre/maplibre-gl-leaflet", () => ({ maplibreGL: h.maplibreGL }))

import TrackingMap, { courierLabel } from "./tracking-map"

const iconLabels = () =>
  h.lib.divIcon.mock.calls.map(
    ([o]) => (o as { html: HTMLElement }).html.textContent
  )

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXT_PUBLIC_ESRI_API_KEY", "")
})

describe("TrackingMap", () => {
  it("encuadra la ruta completa una sola vez por envío", () => {
    const t = trackingFixture()
    const { rerender } = render(
      <TrackingMap tracking={t} follow={false} theme="light" />
    )
    expect(h.map.fitBounds).toHaveBeenCalledTimes(1)
    rerender(
      <TrackingMap tracking={trackingFixture()} follow={false} theme="light" />
    )
    expect(h.map.fitBounds).toHaveBeenCalledTimes(1)
  })

  it("etiqueta retiro y entrega con su barrio", () => {
    render(
      <TrackingMap tracking={trackingFixture()} follow={false} theme="light" />
    )
    expect(iconLabels()).toEqual(
      expect.arrayContaining(["Nueva Córdoba", "Cerro de las Rosas"])
    )
  })

  it("con alerta marca al transportista en ámbar con 'sin señal' y la hora del ping", () => {
    render(
      <TrackingMap
        tracking={trackingFixture({ signalLost: true, delayed: true })}
        follow={false}
        theme="light"
      />
    )
    const courier = h.lib.divIcon.mock.calls
      .map(([o]) => (o as { html: HTMLElement }).html)
      .find((el) => el.querySelector(".mv-track-courier"))
    expect(courier?.querySelector(".mv-track-courier")).toHaveAttribute(
      "data-alert",
      "true"
    )
    expect(courier?.textContent).toMatch(/^sin señal · /)
  })

  it("sin alerta el transportista va sin etiqueta", () => {
    expect(courierLabel(trackingFixture())).toBe("")
    expect(courierLabel(trackingFixture({ delayed: true }))).toBe("demorado")
  })

  it("'Seguir' centra en cada actualización solo si está activo", () => {
    const { rerender } = render(
      <TrackingMap tracking={trackingFixture()} follow={false} theme="light" />
    )
    expect(h.map.panTo).not.toHaveBeenCalled()
    rerender(
      <TrackingMap tracking={trackingFixture()} follow={true} theme="light" />
    )
    expect(h.map.panTo).toHaveBeenCalledWith([39, -120.5], { animate: false })
    expect(h.map.panTo).toHaveBeenCalledTimes(1)
    h.map.panTo.mockClear()
    rerender(
      <TrackingMap
        tracking={trackingFixture({
          lastPosition: {
            lat: 40,
            lng: -121,
            accuracyM: 5,
            capturedAt: "2026-10-22T12:00:10Z",
          },
        })}
        follow={true}
        theme="light"
      />
    )
    expect(h.map.panTo).toHaveBeenCalledWith([40, -121], { animate: false })
  })

  it("conserva los íconos cuando solo cambia la lectura o el tema", () => {
    const { rerender } = render(
      <TrackingMap tracking={trackingFixture()} follow={false} theme="light" />
    )
    expect(h.lib.divIcon).toHaveBeenCalledTimes(3)
    rerender(
      <TrackingMap tracking={trackingFixture()} follow={false} theme="dark" />
    )
    expect(h.lib.divIcon).toHaveBeenCalledTimes(3)
    rerender(
      <TrackingMap
        tracking={trackingFixture({ delayed: true })}
        follow={false}
        theme="dark"
      />
    )
    expect(h.lib.divIcon).toHaveBeenCalledTimes(4)
  })

  it("cambia las teselas con el tema cuando hay API key", () => {
    vi.stubEnv("NEXT_PUBLIC_ESRI_API_KEY", "k")
    const { rerender } = render(
      <TrackingMap tracking={trackingFixture()} follow={false} theme="light" />
    )
    rerender(
      <TrackingMap tracking={trackingFixture()} follow={false} theme="dark" />
    )
    const styles = h.maplibreGL.mock.calls.map(
      ([o]) => (o as { style: string }).style
    )
    expect(styles[0]).toContain("/arcgis/light-gray")
    expect(styles[1]).toContain("/arcgis/dark-gray")
  })

  it("destruye el mapa al desmontar", () => {
    const { unmount } = render(
      <TrackingMap tracking={trackingFixture()} follow={false} theme="light" />
    )
    unmount()
    expect(h.map.remove).toHaveBeenCalled()
  })
})
