import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  search: new URLSearchParams(),
  params: {} as { id?: string },
}))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/support",
  useParams: () => nav.params,
  useSearchParams: () => nav.search,
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
const client = vi.hoisted(() => ({ list: vi.fn(), counts: vi.fn() }))
vi.mock("@/lib/support/client", () => ({ supportClient: client }))
vi.mock("./support-provider", () => ({ useSupportMessages: () => {} }))

import { ConversationList } from "./conversation-list"
import { row } from "./fixtures"

const counts = {
  byStatus: { open: 4, awaiting_user: 2, resolved: 7 },
  byOwner: { all: 4, mine: 1, none: 3 },
  unreadTotal: 3,
}

beforeEach(() => {
  nav.replace.mockReset()
  nav.search = new URLSearchParams()
  nav.params = {}
  client.list.mockReset().mockResolvedValue({ items: [row()], nextCursor: null })
  client.counts.mockReset().mockResolvedValue(counts)
})
afterEach(() => cleanup())

describe("lista de consultas", () => {
  it("muestra pestañas y chips con conteo, y la fila con sus datos", async () => {
    render(<ConversationList meId="me" />)
    expect(await screen.findByText("Carolina Sánchez")).toBeTruthy()
    expect(screen.getByRole("tab", { name: /Abiertos/ }).textContent).toContain("4")
    expect(screen.getByRole("tab", { name: /Esperando/ }).textContent).toContain("2")
    expect(screen.getByRole("button", { name: /Sin asignar/ }).textContent).toContain("3")
    expect(screen.getByText("espera 23 min").className).toContain("text-danger-fg")
    expect(screen.getByText("SOP-1042")).toBeTruthy()
    expect(screen.getByText("Envío")).toBeTruthy()
    expect(screen.getByRole("img", { name: "Prioridad urgente" })).toBeTruthy()
  })

  it("la espera corta no va en rojo y la prioridad normal no se muestra", async () => {
    client.list.mockResolvedValue({ items: [row({ waitMinutes: 6, priority: "normal" })], nextCursor: null })
    render(<ConversationList meId="me" />)
    expect((await screen.findByText("espera 6 min")).className).not.toContain("danger")
    expect(screen.queryByRole("img", { name: /Prioridad/ })).toBeNull()
  })

  it("pide al backend el estado y la asignación de la URL", async () => {
    nav.search = new URLSearchParams("status=awaiting_user&owner=mine&q=caro")
    render(<ConversationList meId="me" />)
    await waitFor(() =>
      expect(client.list).toHaveBeenCalledWith(
        { status: "awaiting_user", assignee: "me", q: "caro" },
        expect.anything()
      )
    )
  })

  it("cambiar de pestaña o chip actualiza la URL", async () => {
    render(<ConversationList meId="me" />)
    await screen.findByText("Carolina Sánchez")
    fireEvent.click(screen.getByRole("tab", { name: /Resueltos/ }))
    expect(nav.replace).toHaveBeenCalledWith("/support?status=resolved", { scroll: false })
    fireEvent.click(screen.getByRole("button", { name: /Míos/ }))
    expect(nav.replace).toHaveBeenCalledWith("/support?owner=mine", { scroll: false })
  })

  it("muestra el vacío de la pestaña", async () => {
    client.list.mockResolvedValue({ items: [], nextCursor: null })
    render(<ConversationList meId="me" />)
    expect(await screen.findByText("Todo tranquilo por acá.")).toBeTruthy()
  })

  it("antepone 'Vos:' al último mensaje propio y el nombre al de otro agente", async () => {
    const agent = (authorId: string, authorName: string) =>
      row({ lastMessage: { from: "agent", authorId, authorName, body: "Hola", hasAttachments: false, createdAt: "" } })
    client.list.mockResolvedValue({
      items: [agent("me", "Tomás Ferreyra"), { ...agent("lb", "Lucía Bustos"), id: "b2222222-2222-4222-8222-222222222222" }],
      nextCursor: null,
    })
    render(<ConversationList meId="me" />)
    expect(await screen.findByText("Vos: Hola")).toBeTruthy()
    expect(screen.getByText("Lucía: Hola")).toBeTruthy()
  })

  it("errores de carga se reintentan", async () => {
    client.list.mockRejectedValueOnce(new Error("x"))
    render(<ConversationList meId="me" />)
    fireEvent.click(await screen.findByRole("button", { name: /Reintentar/ }))
    expect(await screen.findByText("Carolina Sánchez")).toBeTruthy()
  })

  it("carga más con el cursor", async () => {
    client.list.mockResolvedValueOnce({ items: [row()], nextCursor: "1" })
    client.list.mockResolvedValueOnce({
      items: [row({ id: "c3333333-3333-4333-8333-333333333333", user: { id: "u2", fullName: "Diego Fernández", role: "carrier" } })],
      nextCursor: null,
    })
    render(<ConversationList meId="me" />)
    fireEvent.click(await screen.findByRole("button", { name: "Cargar más" }))
    expect(await screen.findByText("Diego Fernández")).toBeTruthy()
    expect(client.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "1" }))
  })

  it("las flechas mueven el foco entre filas", async () => {
    client.list.mockResolvedValue({
      items: [row(), row({ id: "d4444444-4444-4444-8444-444444444444", code: "SOP-1043" })],
      nextCursor: null,
    })
    render(<ConversationList meId="me" />)
    const links = await screen.findAllByRole("link")
    links[0].focus()
    fireEvent.keyDown(links[0], { key: "ArrowDown" })
    expect(document.activeElement).toBe(links[1])
    fireEvent.keyDown(links[1], { key: "ArrowUp" })
    expect(document.activeElement).toBe(links[0])
  })
})
