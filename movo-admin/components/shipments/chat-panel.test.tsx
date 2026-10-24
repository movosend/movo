import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"

const actions = vi.hoisted(() => ({ loadChatPage: vi.fn() }))
vi.mock("@/app/shipments/actions", () => actions)

import type { AdminChatPage } from "@movo/shared/src/types/admin-shipments"
import { CARRIER, message, SENDER } from "@/lib/shipments/test-fixtures"
import { ChatPanel } from "./chat-panel"

afterEach(() => {
  cleanup()
  actions.loadChatPage.mockReset()
})

const page = (over: Partial<AdminChatPage>): AdminChatPage => ({
  items: [],
  nextCursor: null,
  partiesAccess: "open",
  archived: false,
  reports: [],
  events: [],
  ...over,
})

const heading = {
  code: "4800bc55",
  title: "Ana, Diego y Luis",
  people: [
    { id: "u1", name: "Ana Molina", photoUrl: null },
    { id: "u2", name: "Diego Funes", photoUrl: null },
    { id: "u3", name: "Luis Herrera", photoUrl: null },
  ],
  photos: {},
  mode: "las partes pueden escribir",
  reports: [],
}

const open = (first: AdminChatPage) => {
  render(
    <ChatPanel
      shipmentId="4800bc55-a000-4000-8000-000000048213"
      heading={heading}
      first={first}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: /Ver chat/ }))
}

describe("panel del chat", () => {
  it("abre con el título, el modo y la cantidad de mensajes (con + si hay más)", () => {
    open(
      page({
        items: [message("Hola", "2026-10-21T14:00:00.000Z")],
        nextCursor: "o6",
      })
    )
    expect(screen.getByText("Ana, Diego y Luis")).toBeTruthy()
    expect(
      screen.getByText(/las partes pueden escribir · 1\+ mensajes/)
    ).toBeTruthy()
  })

  it("'Ver mensajes anteriores' suma la página siguiente sin perder lo cargado", async () => {
    actions.loadChatPage.mockResolvedValue({
      ok: true,
      page: page({
        items: [message("Mensaje viejo", "2026-10-21T10:00:00.000Z", CARRIER)],
      }),
    })
    open(
      page({
        items: [message("Mensaje nuevo", "2026-10-21T14:00:00.000Z", SENDER)],
        nextCursor: "o6",
      })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Ver mensajes anteriores" })
    )
    await waitFor(() => expect(screen.getByText("Mensaje viejo")).toBeTruthy())
    expect(actions.loadChatPage).toHaveBeenCalledWith(
      "4800bc55-a000-4000-8000-000000048213",
      "o6"
    )
    expect(screen.getByText("Mensaje nuevo")).toBeTruthy()
    // Sin más páginas, el botón desaparece.
    expect(
      screen.queryByRole("button", { name: "Ver mensajes anteriores" })
    ).toBeNull()
  })

  it("una primera página nueva (Reintentar) reemplaza lo cargado", async () => {
    actions.loadChatPage.mockResolvedValue({
      ok: true,
      page: page({
        items: [message("Mensaje viejo", "2026-10-21T10:00:00.000Z", CARRIER)],
      }),
    })
    const props = {
      shipmentId: "4800bc55-a000-4000-8000-000000048213",
      heading,
    }
    const { rerender } = render(
      <ChatPanel
        {...props}
        first={page({
          items: [message("Mensaje nuevo", "2026-10-21T14:00:00.000Z")],
          nextCursor: "o6",
        })}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /Ver chat/ }))
    fireEvent.click(
      screen.getByRole("button", { name: "Ver mensajes anteriores" })
    )
    await waitFor(() => expect(screen.getByText("Mensaje viejo")).toBeTruthy())
    rerender(
      <ChatPanel
        {...props}
        first={page({
          items: [message("Recién llegado", "2026-10-21T15:00:00.000Z")],
          nextCursor: "o9",
        })}
      />
    )
    expect(screen.getByText("Recién llegado")).toBeTruthy()
    expect(screen.queryByText("Mensaje viejo")).toBeNull()
    expect(
      screen.getByRole("button", { name: "Ver mensajes anteriores" })
    ).toBeTruthy()
  })

  it("si la página siguiente falla, avisa y deja reintentar", async () => {
    actions.loadChatPage.mockResolvedValue({ ok: false, status: 502 })
    open(
      page({
        items: [message("Mensaje nuevo", "2026-10-21T14:00:00.000Z")],
        nextCursor: "o6",
      })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Ver mensajes anteriores" })
    )
    await waitFor(() =>
      expect(
        screen.getByText("No pudimos cargar más mensajes (502).")
      ).toBeTruthy()
    )
    expect(screen.getByText("Mensaje nuevo")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Ver mensajes anteriores" })
    ).toBeTruthy()
  })
})
