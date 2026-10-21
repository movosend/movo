import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"

const actions = vi.hoisted(() => ({ createSupportAttachment: vi.fn() }))
vi.mock("@/app/support/actions", () => actions)

import { Composer } from "./composer"

const onSend = vi.fn()
const setup = (over: Partial<React.ComponentProps<typeof Composer>> = {}) =>
  render(
    <Composer
      conversationId="c1"
      userName="Carolina Sánchez"
      agentName="Tomás Ferreyra"
      resolved={false}
      blocked={null}
      onSend={onSend}
      {...over}
    />
  )
const box = () => screen.getByRole("textbox") as HTMLTextAreaElement
const type = (value: string) => fireEvent.change(box(), { target: { value } })

beforeEach(() => {
  onSend.mockReset()
  actions.createSupportAttachment.mockReset()
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => {},
    })
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("compositor", () => {
  it("Enter envía y Shift+Enter no", () => {
    setup()
    type("Hola Carolina")
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box(), { key: "Enter" })
    expect(onSend).toHaveBeenCalledWith({
      body: "Hola Carolina",
      internal: false,
      attachments: [],
    })
    expect(box().value).toBe("")
  })

  it("el modo nota cambia el placeholder, el botón y envía internal", () => {
    setup()
    expect(box().placeholder).toBe("Escribile a Carolina…")
    fireEvent.click(screen.getByRole("tab", { name: /Nota interna/ }))
    expect(box().placeholder).toContain("Carolina no la ve")
    expect(screen.getByText("Solo la ve el equipo de soporte")).toBeTruthy()
    type("Pedir fotos al transportista")
    fireEvent.click(screen.getByRole("button", { name: /Guardar nota/ }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ internal: true })
    )
  })

  it("no envía vacío", () => {
    setup()
    expect(
      (screen.getByRole("button", { name: /Enviar/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    type("   ")
    fireEvent.keyDown(box(), { key: "Enter" })
    expect(onSend).not.toHaveBeenCalled()
  })

  it("las respuestas rápidas resuelven {nombre} y {agente}", async () => {
    setup()
    fireEvent.click(screen.getByRole("button", { name: /Respuestas rápidas/ }))
    fireEvent.click(await screen.findByText("Saludo"))
    expect(box().value).toBe(
      "Hola Carolina, soy Tomás del equipo de Movo. Ya estoy viendo tu consulta."
    )
  })

  it("sube la imagen, la muestra con vista previa y permite quitarla", async () => {
    actions.createSupportAttachment.mockResolvedValue({
      ok: true,
      data: { attachmentId: "att-1", uploadUrl: "/up", expiresAt: "" },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    )
    setup()
    const file = new File([new Uint8Array(10)], "daño.png", {
      type: "image/png",
    })
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [file] },
    })
    await waitFor(() =>
      expect(actions.createSupportAttachment).toHaveBeenCalled()
    )
    expect(screen.getByAltText("daño.png")).toBeTruthy()
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Enviar/ }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    )
    fireEvent.click(screen.getByRole("button", { name: /Enviar/ }))
    expect(onSend.mock.calls[0][0].attachments[0]).toMatchObject({
      attachmentId: "att-1",
      state: "ready",
    })
  })

  it("rechaza archivos que no son imágenes admitidas", () => {
    setup()
    fireEvent.change(screen.getByTestId("file-input"), {
      target: {
        files: [new File(["x"], "nota.pdf", { type: "application/pdf" })],
      },
    })
    expect(screen.getByText(/no es una imagen JPG, PNG o WebP/)).toBeTruthy()
    expect(actions.createSupportAttachment).not.toHaveBeenCalled()
  })

  it("quitar una vista previa antes de enviar la descarta", async () => {
    actions.createSupportAttachment.mockResolvedValue({
      ok: true,
      data: { attachmentId: "a", uploadUrl: "/up", expiresAt: "" },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    )
    setup()
    fireEvent.change(screen.getByTestId("file-input"), {
      target: {
        files: [new File([new Uint8Array(4)], "a.png", { type: "image/png" })],
      },
    })
    fireEvent.click(await screen.findByRole("button", { name: "Quitar a.png" }))
    expect(screen.queryByAltText("a.png")).toBeNull()
  })

  it("bloqueado por conflicto de interés: aviso y todo deshabilitado", () => {
    setup({ blocked: "Esta consulta es tuya: no podés responderla." })
    expect(screen.getByRole("alert").textContent).toContain(
      "Esta consulta es tuya"
    )
    expect(box().disabled).toBe(true)
    expect(
      (screen.getByRole("button", { name: /Enviar/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it("avisa que responder reabre una conversación resuelta", () => {
    setup({ resolved: true })
    expect(
      screen.getByText("Conversación resuelta. Si respondés, se reabre.")
    ).toBeTruthy()
  })
})
