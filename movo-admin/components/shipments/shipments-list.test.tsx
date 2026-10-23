import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => nav }))
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    scroll,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    scroll?: boolean
  }) => {
    void scroll
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
}))

import type { AdminShipmentPage } from "@movo/shared/src/types/admin-shipments"
import { EMPTY_LIST_STATE } from "@/lib/shipments/params"
import { NOW, row } from "@/lib/shipments/test-fixtures"
import { ShipmentFilters } from "./shipment-filters"
import {
  ShipmentRowLink,
  ShipmentsEmpty,
  ShipmentsPager,
} from "./shipment-table"

const counts: Pick<
  AdminShipmentPage,
  "counts" | "statusCounts" | "alertCounts"
> = {
  counts: {
    all: 12,
    unassigned: 3,
    assigning: 2,
    in_progress: 6,
    closed: 40,
    disputes: 1,
  },
  statusCounts: {
    awaiting_receiver_confirmation: 1,
    rejected_by_receiver: 1,
    published: 1,
    assignment_pending: 1,
    assigned_unfunded: 1,
    assigned: 2,
    in_transit: 4,
    delivered: 10,
    completed: 25,
    cancelled: 5,
    disputed: 1,
  },
  alertCounts: {
    all: 4,
    unassigned: 1,
    assigning: 1,
    in_progress: 1,
    closed: 0,
    disputes: 1,
  },
}

afterEach(cleanup)

describe("tabla de envíos", () => {
  it("fila: código, hora, estado, ruta, partes, retiro y precio", () => {
    render(<ShipmentRowLink row={row()} href="/shipments/x" now={NOW} />)
    const link = screen.getByRole("link")
    expect(link.getAttribute("href")).toBe("/shipments/x")
    expect(within(link).getByText("#4800bc55")).toBeTruthy()
    expect(within(link).getByText("hace 6 min")).toBeTruthy()
    expect(within(link).getAllByText("En camino").length).toBeGreaterThan(0)
    expect(within(link).getByText("Córdoba → Villa Allende")).toBeTruthy()
    expect(
      within(link).getByText("Ana M. → Luis H. · vía Diego F.")
    ).toBeTruthy()
    expect(
      within(link).getByText("Av. Colón 1234, Alberdi → Av. San Martín 1200")
    ).toBeTruthy()
    expect(within(link).getByText("Hoy · 09:00 a 12:00 hs")).toBeTruthy()
    expect(within(link).getByText("$6.800")).toBeTruthy()
  })

  it("el aviso va en un renglón propio", () => {
    render(
      <ShipmentRowLink
        row={row({
          status: "assigned_unfunded",
          fundingDeadline: "2026-10-21T20:00:00.000Z",
        })}
        href="/shipments/x"
        now={NOW}
      />
    )
    expect(screen.getByText("La ventana de pago vence en 5 h")).toBeTruthy()
  })

  it("sin transportista: precio sugerido", () => {
    render(
      <ShipmentRowLink
        row={row({ carrier: null, priceKind: "suggested" })}
        href="/x"
        now={NOW}
      />
    )
    expect(screen.getByText("sugerido")).toBeTruthy()
    expect(screen.getByText("Sin transportista")).toBeTruthy()
  })

  it("vacío con filtros", () => {
    render(<ShipmentsEmpty filtered />)
    expect(screen.getByText("No hay envíos con esos filtros")).toBeTruthy()
  })

  it("paginado: anterior deshabilitado en la primera página", () => {
    render(
      <ShipmentsPager
        page={1}
        prevHref={null}
        nextHref="/shipments?cursor=c2"
      />
    )
    expect(screen.getByText("Página 1")).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Anterior/ })).toBeNull()
    expect(
      screen.getByRole("link", { name: /Siguiente/ }).getAttribute("href")
    ).toBe("/shipments?cursor=c2")
  })
})

describe("filtros", () => {
  beforeEach(() => {
    nav.replace.mockClear()
    nav.refresh.mockClear()
  })

  const setup = (state = EMPTY_LIST_STATE) =>
    render(
      <ShipmentFilters
        state={state}
        counts={counts}
        resultLabel="12 envíos"
        loadedAt={NOW.toISOString()}
      />
    )

  it("pestañas con su conteo; elegir una navega sin cursor", () => {
    setup({ ...EMPTY_LIST_STATE, cursor: "c2" })
    const tabs = screen.getAllByRole("tab")
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Todos12",
      "Sin asignar3",
      "Asignando2",
      "En curso6",
      "Cerrados40",
      "Disputas1",
    ])
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true")
    fireEvent.click(tabs[4]!)
    expect(nav.replace).toHaveBeenCalledWith("/shipments?group=closed", {
      scroll: false,
    })
  })

  it("dentro de un grupo con varios estados hay chips con su conteo", () => {
    setup({ ...EMPTY_LIST_STATE, tab: "closed" })
    expect(screen.getByRole("button", { name: /Entregado\s*10/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Cancelado\s*5/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Cancelado/ }))
    expect(nav.replace).toHaveBeenCalledWith(
      "/shipments?group=closed&status=cancelled",
      { scroll: false }
    )
  })

  it("en Disputas (un solo estado) no hay chips", () => {
    setup({ ...EMPTY_LIST_STATE, tab: "disputes" })
    expect(screen.queryByRole("button", { name: /En disputa/ })).toBeNull()
  })

  it("'Solo con alerta' muestra el conteo de la pestaña y se activa", () => {
    setup({ ...EMPTY_LIST_STATE, tab: "assigning" })
    const toggle = screen.getByRole("button", { name: /Solo con alerta/ })
    expect(toggle.textContent).toContain("1")
    expect(toggle.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(toggle)
    expect(nav.replace).toHaveBeenCalledWith(
      "/shipments?group=assigning&alert=1",
      { scroll: false }
    )
  })

  it("la búsqueda espera a que se deje de escribir", () => {
    vi.useFakeTimers()
    try {
      setup()
      fireEvent.change(screen.getByLabelText("Buscar envíos"), {
        target: { value: "#4800" },
      })
      expect(nav.replace).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(400)
      })
      expect(nav.replace).toHaveBeenCalledWith("/shipments?q=%234800", {
        scroll: false,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("recargar pide la página de nuevo y muestra la hora de la carga", () => {
    setup()
    const reload = screen.getByRole("button", { name: /Actualizado/ })
    expect(reload.textContent).toContain("12:00")
    fireEvent.click(reload)
    expect(nav.refresh).toHaveBeenCalled()
  })
})
