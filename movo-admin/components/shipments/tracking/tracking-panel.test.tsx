import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { trackingFixture } from "./fixtures"

const mapProps = vi.hoisted(() => ({ last: null as null | { follow: boolean; theme: string } }))

vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub(props: { follow: boolean; theme: string }) {
      mapProps.last = props
      return <div data-testid="map" />
    },
}))
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }))

import { TrackingView } from "./tracking-panel"

afterEach(cleanup)

describe("TrackingView", () => {
  it.each([
    ["awaiting_pickup", "not_started", "Todavía no arrancó", /retira en la ventana 09:00–11:00/],
    ["unfunded", "not_started", "Todavía no arrancó", /Sin fondos reservados/],
    ["no_carrier", "no_carrier", "Sin seguimiento", /no tiene transportista/],
  ] as const)("%s: mensaje sin mapa", (reason, state, title, body) => {
    render(
      <TrackingView
        tracking={trackingFixture({ state, reason, trace: [], lastPosition: null, metrics: null })}
        status="live"
      />
    )
    expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.getByText(body)).toBeInTheDocument()
    expect(screen.queryByTestId("map")).not.toBeInTheDocument()
    expect(screen.queryByText("Último ping")).not.toBeInTheDocument()
  })

  it.each([
    ["delivered", "Seguimiento cerrado"],
    ["completed", "Seguimiento cerrado"],
    ["disputed", "Seguimiento cortado"],
  ] as const)("%s: muestra la traza como evidencia", (reason, title) => {
    render(
      <TrackingView
        tracking={trackingFixture({ state: "closed", reason, metrics: null, lastPosition: null })}
        status="live"
      />
    )
    expect(screen.getByTestId("map")).toBeInTheDocument()
    expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Seguir/ })).not.toBeInTheDocument()
  })

  it("cerrado con traza purgada: aviso y sin mapa", () => {
    render(
      <TrackingView
        tracking={trackingFixture({ state: "closed", reason: "completed", trace: [], traceAvailable: false })}
        status="live"
      />
    )
    expect(screen.queryByTestId("map")).not.toBeInTheDocument()
    expect(screen.getByText("La traza GPS ya fue purgada.")).toBeInTheDocument()
  })

  it("en vivo: cuatro tarjetas con los textos de apoyo del prototipo", () => {
    render(<TrackingView tracking={trackingFixture()} status="live" />)
    for (const label of ["Último ping", "Velocidad", "Falta", "Llegada"])
      expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText("hace 3 s")).toBeInTheDocument()
    expect(screen.getByText("GPS del transportista")).toBeInTheDocument()
    expect(screen.getByText("23 km/h")).toBeInTheDocument()
    expect(screen.getByText("4,2 km")).toBeInTheDocument()
    expect(screen.getByText("53% del recorrido")).toBeInTheDocument()
    expect(screen.getByText("ventana 09:00–11:00")).toBeInTheDocument()
    expect(screen.getByText("En vivo")).toBeInTheDocument()
    expect(mapProps.last?.theme).toBe("dark")
  })

  it("en alerta: ping en color de advertencia y velocidad/llegada vacías", () => {
    render(
      <TrackingView
        tracking={trackingFixture({
          signalLost: true,
          delayed: true,
          lastPingAt: "2026-10-22T11:46:00Z",
          metrics: { avgSpeedKmh5m: null, remainingMeters: 4230, progressPct: 53, etaAt: null },
        })}
        status="live"
      />
    )
    expect(screen.getByText("hace 14 min")).toHaveClass("text-warn-fg")
    expect(screen.getByText("sin posiciones nuevas")).toBeInTheDocument()
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2)
  })

  it("toggle 'Seguir al transportista'", () => {
    render(<TrackingView tracking={trackingFixture()} status="live" />)
    const toggle = screen.getByRole("button", { name: "Seguir al transportista" })
    expect(toggle).toHaveAttribute("aria-pressed", "false")
    expect(mapProps.last?.follow).toBe(false)
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-pressed", "true")
    expect(mapProps.last?.follow).toBe(true)
  })

  it("indicador de reconexión", () => {
    render(<TrackingView tracking={trackingFixture()} status="reconnecting" />)
    expect(screen.getByText("Reconectando…")).toBeInTheDocument()
  })
})
