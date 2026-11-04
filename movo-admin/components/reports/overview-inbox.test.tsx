import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type {
  AdminOverview,
  OverviewInbox as Inbox,
} from "@movo/shared/src/types/admin-reports"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { OverviewInbox } from "./overview-inbox"

const at = "2026-11-01T12:00:00Z"
const base = (count: number, over = false): Inbox => ({
  count,
  oldestAt: "2026-11-01T11:00:00Z",
  slaHours: 24,
  overSla: over,
  yesterdayCount: count - 1,
  breakdown: [],
})

const overview: AdminOverview = {
  generatedAt: at,
  blocks: {
    disputes: { data: { ...base(7, true), awaitingPayment: 2 }, error: null },
    support: { data: { ...base(12), urgent: 3 }, error: null },
    kyc: { data: { ...base(18, true), carriers: 11, senders: 7 }, error: null },
    userReports: {
      data: null,
      error: {
        code: "UPSTREAM_TIMEOUT",
        message: "svc-users tardó más de 5 s en responder.",
        requestId: "req_7f2a91c4",
      },
    },
    shipmentAlerts: { data: { ...base(4), inTransit: 4 }, error: null },
    payments: { data: { ...base(3), holdsExpiringToday: 1 }, error: null },
    flaggedMessages: { data: base(9), error: null },
    sanctionsEndingToday: { data: { ...base(2), slaHours: null }, error: null },
  },
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Inicio", () => {
  it("una bandeja caída muestra su error y el resto sigue andando", () => {
    render(<OverviewInbox initial={overview} />)
    expect(
      screen.getByText("No pudimos cargar esta bandeja")
    ).toBeInTheDocument()
    expect(
      screen.getByText(/UPSTREAM_TIMEOUT · req_7f2a91c4/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Disputas abiertas/ })
    ).toHaveAttribute("href", "/disputes")
    expect(
      screen.getByRole("link", { name: /Conversaciones sin responder/ })
    ).toHaveAttribute("href", "/support")
    expect(screen.getByText(/1 bandeja no cargó/)).toBeInTheDocument()
  })

  it("las fuera de plazo van primero, en su propio grupo", () => {
    render(<OverviewInbox initial={overview} />)
    const titles = screen
      .getAllByRole("link")
      .map((l) => l.getAttribute("title"))
    expect(titles.slice(0, 2)).toEqual(["Abrir disputas", "Abrir usuarios"])
    expect(screen.getByText("Fuera de plazo")).toBeInTheDocument()
  })

  it("Reintentar pide solo esa bandeja y la reemplaza", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        generatedAt: at,
        blocks: {
          userReports: { data: { ...base(5), blockRequested: 1 }, error: null },
        },
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    render(<OverviewInbox initial={overview} />)
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/ }))
    expect(fetchMock).toHaveBeenCalledWith("/api/overview?blocks=userReports")
    const row = await screen.findByRole("link", {
      name: /Reportes de usuarios/,
    })
    expect(within(row).getByText("1 pide bloqueo")).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.queryByText("No pudimos cargar esta bandeja")
      ).not.toBeInTheDocument()
    )
  })
})
