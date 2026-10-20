import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"

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
const actions = vi.hoisted(() => ({
  sendSupportMessage: vi.fn(),
  patchSupportConversation: vi.fn(),
  setSupportStatus: vi.fn(),
  markSupportRead: vi.fn(),
  createSupportAttachment: vi.fn(),
}))
vi.mock("@/app/support/actions", () => actions)
const client = vi.hoisted(() => ({
  context: vi.fn(),
  messages: vi.fn(),
  conversation: vi.fn(),
  agents: vi.fn(),
}))
vi.mock("@/lib/support/client", () => ({ supportClient: client }))
vi.mock("../support-provider", () => ({ useSupportMessages: () => {} }))

import { conversation, userContext } from "../fixtures"
import { withPanels } from "../test-utils"
import { ThreadView } from "./thread-view"

const me = { id: "me", fullName: "Tomás Ferreyra" }
const at = (m: number) => new Date(Date.UTC(2026, 9, 20, 15, m)).toISOString()
const messages = {
  items: [
    {
      kind: "internal_note" as const,
      id: "m3",
      conversationId: "c",
      createdAt: at(3),
      body: "Nota del equipo",
      attachments: [],
      author: me,
    },
    {
      kind: "system" as const,
      id: "m2",
      conversationId: "c",
      createdAt: at(2),
      body: "Tomás Ferreyra tomó la conversación",
      actor: me,
    },
    {
      kind: "user" as const,
      id: "m1",
      conversationId: "c",
      createdAt: at(1),
      body: "Me llegó roto",
      attachments: [
        { id: "a1", contentType: "image/png" as const, url: "/img.png" },
      ],
    },
  ],
  nextCursor: null,
}

const setup = (conv = conversation({ unread: 0 })) =>
  render(
    withPanels(
      <ThreadView
        me={me}
        initialConversation={conv}
        initialMessages={messages}
      />
    )
  )

beforeEach(() => {
  Object.values(actions).forEach((f) => f.mockReset())
  actions.markSupportRead.mockResolvedValue({ ok: true, data: null })
  client.context.mockReset().mockResolvedValue(userContext())
  client.messages.mockReset().mockResolvedValue({ items: [], nextCursor: null })
  client.conversation.mockReset()
  client.agents.mockReset().mockResolvedValue([])
})
afterEach(cleanup)

describe("conversación", () => {
  it("muestra mensajes, nota interna diferenciada, evento de sistema e imagen ampliable", async () => {
    setup()
    expect(screen.getByText("Me llegó roto")).toBeTruthy()
    expect(
      screen.getByText("Tomás Ferreyra tomó la conversación · 12:02")
    ).toBeTruthy()
    expect(screen.getByText(/Nota interna · Vos/)).toBeTruthy()
    expect(screen.getByText("Solo la ve el equipo")).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Ampliar imagen adjunta" })
    )
    expect(await screen.findByAltText("Imagen adjunta ampliada")).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    })
    await waitFor(() =>
      expect(screen.queryByAltText("Imagen adjunta ampliada")).toBeNull()
    )
  })

  it("marca como leída al abrir una conversación con no leídos", async () => {
    setup(conversation({ unread: 3 }))
    await waitFor(() =>
      expect(actions.markSupportRead).toHaveBeenCalledWith(conversation().id)
    )
  })

  it("el envío es optimista y se concilia con la respuesta", async () => {
    let done!: (v: unknown) => void
    actions.sendSupportMessage.mockReturnValue(new Promise((r) => (done = r)))
    setup()
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Ya lo reviso" },
    })
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    expect(screen.getByText("Ya lo reviso")).toBeTruthy()
    expect(screen.getByText("Enviando…")).toBeTruthy()
    const sent = actions.sendSupportMessage.mock.calls[0]
    expect(sent[1]).toMatchObject({ body: "Ya lo reviso", internal: false })
    done({
      ok: true,
      data: {
        kind: "agent",
        id: "real",
        conversationId: "c",
        createdAt: at(9),
        clientMessageId: sent[1].clientMessageId,
        body: "Ya lo reviso",
        attachments: [],
        author: me,
      },
    })
    await waitFor(() => expect(screen.queryByText("Enviando…")).toBeNull())
    expect(screen.getAllByText("Ya lo reviso")).toHaveLength(1)
  })

  it("si falla queda 'no enviado' y reintenta con el mismo clientMessageId", async () => {
    actions.sendSupportMessage.mockResolvedValueOnce({
      ok: false,
      error: "Sin conexión.",
    })
    setup()
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hola" } })
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    expect(await screen.findByText("Sin conexión.")).toBeTruthy()
    actions.sendSupportMessage.mockResolvedValueOnce({
      ok: true,
      data: {
        kind: "agent",
        id: "r",
        conversationId: "c",
        createdAt: at(9),
        body: "Hola",
        attachments: [],
        author: me,
      },
    })
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }))
    await waitFor(() =>
      expect(actions.sendSupportMessage).toHaveBeenCalledTimes(2)
    )
    expect(actions.sendSupportMessage.mock.calls[1][1].clientMessageId).toBe(
      actions.sendSupportMessage.mock.calls[0][1].clientMessageId
    )
  })

  it("403 de conflicto de interés: aviso claro y compositor deshabilitado", async () => {
    actions.sendSupportMessage.mockResolvedValue({
      ok: false,
      code: "ADMIN_CONFLICT_OF_INTEREST",
      error: "x",
    })
    setup()
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hola" } })
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    expect(await screen.findByText(/Esta consulta es tuya/)).toBeTruthy()
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(
      true
    )
  })

  it("una consulta propia se abre ya bloqueada", () => {
    setup(
      conversation({
        unread: 0,
        user: { id: "me", fullName: "Tomás Ferreyra", role: "sender" },
      })
    )
    expect(screen.getByText(/Esta consulta es tuya/)).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: /Resolver/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it("Resolver llama a la acción y refleja el estado nuevo", async () => {
    actions.setSupportStatus.mockResolvedValue({
      ok: true,
      data: conversation({ status: "resolved", unread: 0 }),
    })
    setup()
    fireEvent.click(screen.getByRole("button", { name: /Resolver/ }))
    expect(await screen.findByRole("button", { name: /Reabrir/ })).toBeTruthy()
    expect(actions.setSupportStatus).toHaveBeenCalledWith(
      conversation().id,
      "resolve"
    )
  })

  it("un error al cambiar la prioridad se avisa sin perder la conversación", async () => {
    actions.patchSupportConversation.mockResolvedValue({
      ok: false,
      error: "El servicio no respondió.",
    })
    setup()
    fireEvent.click(screen.getByRole("button", { name: /Urgente/ }))
    fireEvent.click(await screen.findByText("Baja"))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "El servicio no respondió."
    )
    expect(screen.getByText("Me llegó roto")).toBeTruthy()
  })
})

describe("columnas laterales", () => {
  it("el botón del borde oculta la ficha y la vuelve a mostrar en pantallas anchas", () => {
    setup()
    const aside = () =>
      screen.getByLabelText("Ficha del usuario", { selector: "aside" })
    expect(aside().hasAttribute("inert")).toBe(false)
    fireEvent.click(
      screen.getByRole("button", { name: "Ocultar la ficha del usuario" })
    )
    expect(aside().hasAttribute("inert")).toBe(true)
    fireEvent.click(
      screen.getByRole("button", { name: "Mostrar la ficha del usuario" })
    )
    expect(aside().hasAttribute("inert")).toBe(false)
  })
})
