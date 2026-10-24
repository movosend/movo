import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"

const actions = vi.hoisted(() => ({
  loadLedgerMore: vi.fn(),
  loadAuditMore: vi.fn(),
  loadActivityPage: vi.fn(),
  loadRatingsPage: vi.fn(),
}))
vi.mock("@/app/users/[id]/actions", () => actions)
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import type {
  AdminUserLedger,
  AdminUserReport,
} from "@movo/shared/src/types/admin-users"
import { FichaProvider } from "../ficha-status"
import { BlocksPanel } from "./blocks-panel"
import { LedgerPanel } from "./ledger-panel"
import { ReportsPanel } from "./reports-panel"

const ID = "7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e5f6"
const entry = (i: number): AdminUserLedger["items"][number] => ({
  id: `e${i}`,
  type: "cash_commission",
  amountArs: 100 + i,
  status: "pending",
  shipmentId: null,
  reason: `Movimiento ${i}`,
  adminName: null,
  createdAt: "2026-10-15T15:00:00.000Z",
})
const report = (i: number): AdminUserReport => ({
  id: `r${i}`,
  reason: "no_show",
  status: "pending",
  counterpart: { id: `u${i}`, fullName: `Persona ${i}`, photoUrl: null },
  details: `Detalle ${i}`,
  createdAt: "2026-10-17T15:00:00.000Z",
  extraEntries: 0,
  photos: 0,
})

afterEach(() => {
  cleanup()
  Object.values(actions).forEach((m) => m.mockReset())
})

const wrap = (ui: React.ReactNode) =>
  render(<FichaProvider>{ui}</FichaProvider>)

describe("Cuenta corriente", () => {
  it("'Ver más' agrega la página siguiente y desaparece al terminar", async () => {
    actions.loadLedgerMore.mockResolvedValue({
      ok: true,
      data: { balanceArs: 0, items: [entry(3)], nextCursor: null },
    })
    wrap(
      <LedgerPanel
        userId={ID}
        initial={{
          balanceArs: 300,
          items: [entry(1), entry(2)],
          nextCursor: "2",
        }}
      />
    )
    expect(screen.queryByText("Movimiento 3")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }))
    expect(await screen.findByText(/Movimiento 3/)).toBeInTheDocument()
    expect(actions.loadLedgerMore).toHaveBeenCalledWith(ID, "2")
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Ver más/ })
      ).not.toBeInTheDocument()
    )
    expect(screen.getByText(/Movimiento 1/)).toBeInTheDocument()
  })

  it("si falla la página siguiente avisa y deja reintentar, sin perder lo ya cargado", async () => {
    actions.loadLedgerMore.mockResolvedValueOnce({ ok: false, status: 502 })
    wrap(
      <LedgerPanel
        userId={ID}
        initial={{ balanceArs: 100, items: [entry(1)], nextCursor: "1" }}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos cargar más movimientos (502)"
    )
    expect(screen.getByText(/Movimiento 1/)).toBeInTheDocument()
    // El alert aparece con `failed`, pero el botón sigue en "Cargando…" hasta que termina la transición:
    // se espera, no se busca en seco (fallaba de forma intermitente en CI).
    expect(
      await screen.findByRole("button", { name: "Reintentar" })
    ).toBeInTheDocument()
  })
})

describe("Reportes", () => {
  it("pagina de a 5 y avisa si el servidor mandó solo los más recientes", () => {
    const received = Array.from({ length: 7 }, (_, i) => report(i + 1))
    wrap(
      <ReportsPanel
        received={received}
        made={[]}
        totals={{ received: 60, made: 0 }}
      />
    )
    expect(screen.getByText("Detalle 1")).toBeInTheDocument()
    expect(screen.queryByText("Detalle 6")).not.toBeInTheDocument()
    expect(
      screen.getByText("Se muestran los 7 más recientes de 60.")
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Página 2" }))
    expect(screen.getByText("Detalle 6")).toBeInTheDocument()
    expect(screen.queryByText("Detalle 1")).not.toBeInTheDocument()
  })
})

describe("Bloqueos", () => {
  it("muestra los primeros y ofrece ver el resto", () => {
    const made = Array.from({ length: 9 }, (_, i) => ({
      user: { id: `u${i}`, fullName: `Bloqueado ${i + 1}`, photoUrl: null },
      createdAt: "2026-08-14T15:00:00.000Z",
    }))
    wrap(
      <BlocksPanel
        blocks={{ made, received: [] }}
        totals={{
          reportsReceived: 0,
          reportsMade: 0,
          blocksMade: 9,
          blocksReceived: 0,
        }}
      />
    )
    expect(screen.queryByText("Bloqueado 7")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Ver 3 más" }))
    expect(screen.getByText("Bloqueado 9")).toBeInTheDocument()
  })
})
