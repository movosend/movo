import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"

const actions = vi.hoisted(() => ({ loadActivityPage: vi.fn() }))
vi.mock("@/app/users/[id]/actions", () => actions)

import type { AdminUserShipmentPage } from "@movo/shared/src/types/admin-users"
import { FichaProvider } from "../ficha-status"
import { ActivityPanel } from "./activity-panel"

const ID = "7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e5f6"
const empty = (
  counts = { sender: 0, carrier: 2, receiver: 0 }
): AdminUserShipmentPage => ({
  items: [],
  page: 1,
  pageSize: 5,
  total: 0,
  counts,
})

afterEach(() => {
  cleanup()
  actions.loadActivityPage.mockReset()
})

const mount = (initial: AdminUserShipmentPage) =>
  render(
    <FichaProvider>
      <ActivityPanel userId={ID} initialTab="carrier" initial={initial} />
    </FichaProvider>
  )

describe("Actividad", () => {
  it("cambiar de pestaña pide solo esa página y muestra el vacío de esa pestaña", async () => {
    actions.loadActivityPage.mockResolvedValue({ ok: true, data: empty() })
    mount(empty())
    expect(screen.getByText("Nunca transportó")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: /Como emisor/ }))
    await waitFor(() =>
      expect(screen.getByText("Nunca envió")).toBeInTheDocument()
    )
    expect(actions.loadActivityPage).toHaveBeenCalledWith(ID, "sender", 1)
  })

  it("muestra el error de la página con reintento, sin romper el resto", async () => {
    actions.loadActivityPage.mockResolvedValueOnce({ ok: false, status: 502 })
    mount(empty())
    fireEvent.click(screen.getByRole("tab", { name: "Viajes" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("GET /admin/users/7f3c9a10…/trips · 502")
    actions.loadActivityPage.mockResolvedValueOnce({
      ok: true,
      data: { items: [], page: 1, pageSize: 5, total: 0 },
    })
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }))
    expect(await screen.findByText("Sin viajes")).toBeInTheDocument()
  })
})
