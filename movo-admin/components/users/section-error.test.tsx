import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => nav }))
vi.mock("server-only", () => ({}))
const load = vi.hoisted(() => ({ loadSection: vi.fn() }))
vi.mock("@/lib/users/load", () => ({
  loadSection: load.loadSection,
  loadModeration: load.loadSection,
}))

import { FichaProvider } from "./ficha-status"
import { KycSection } from "./sections/kyc-section"
import { VehicleSection } from "./sections/vehicle-section"

const ID = "7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e5f6"

afterEach(() => {
  cleanup()
  nav.refresh.mockClear()
})

describe("una sección con error", () => {
  it("muestra el error en su lugar y el resto de la ficha se ve igual", async () => {
    load.loadSection.mockImplementation(async (_id: string, key: string) =>
      key === "kyc"
        ? { ok: false, status: 502 }
        : {
            ok: true,
            data: {
              vehicle: {
                brand: "Fiat",
                model: "Cronos",
                licensePlate: "AF 412 KD",
                cargoCapacityLabel: "Baúl mediano",
              },
            },
          }
    )
    const kyc = await KycSection({ id: ID, isCarrier: true })
    const vehicle = await VehicleSection({ id: ID, isCarrier: true })
    render(
      <FichaProvider>
        {kyc}
        {vehicle}
      </FichaProvider>
    )
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("No pudimos cargar el KYC.")
    expect(alert).toHaveTextContent("El resto de la ficha no se ve afectado.")
    expect(alert).toHaveTextContent(
      "GET /admin/users/7f3c9a10…/kyc · 502 Bad Gateway"
    )
    // La sección de al lado cargó normalmente.
    expect(screen.getByText("Fiat Cronos")).toBeInTheDocument()
    expect(screen.getByText("AF 412 KD")).toBeInTheDocument()
  })

  it("Reintentar vuelve a pedir la página", async () => {
    load.loadSection.mockResolvedValue({ ok: false, status: 503 })
    const kyc = await KycSection({ id: ID, isCarrier: false })
    render(<FichaProvider>{kyc}</FichaProvider>)
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }))
    expect(nav.refresh).toHaveBeenCalledTimes(1)
  })

  it("muestra los estados vacíos de cada caso", async () => {
    load.loadSection.mockResolvedValue({ ok: true, data: { vehicle: null } })
    const noCarrier = await VehicleSection({ id: ID, isCarrier: false })
    const carrier = await VehicleSection({ id: ID, isCarrier: true })
    const { rerender } = render(<FichaProvider>{noCarrier}</FichaProvider>)
    expect(screen.getByText("No es transportista.")).toBeInTheDocument()
    rerender(<FichaProvider>{carrier}</FichaProvider>)
    expect(screen.getByText(/no cargó la ficha/)).toBeInTheDocument()
  })
})
