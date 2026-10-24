import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ContextPanel } from "./context-panel"
import { conversation, userContext } from "./fixtures"

afterEach(cleanup)
const setup = (
  context: React.ComponentProps<typeof ContextPanel>["context"],
  onPatch = vi.fn(),
  onRetry = vi.fn()
) => {
  render(
    <ContextPanel
      conversation={conversation()}
      context={context}
      disabled={false}
      onPatch={onPatch}
      onRetry={onRetry}
    />
  )
  return { onPatch, onRetry }
}

describe("panel de contexto", () => {
  it("muestra perfil, insignias, reputación, envío vinculado y consultas anteriores", () => {
    setup({ status: "ready", data: userContext() })
    expect(screen.getByText("Receptor · en Movo desde mar 2025")).toBeTruthy()
    expect(screen.getByText("Identidad verificada")).toBeTruthy()
    expect(screen.getByText("KYC aprobado")).toBeTruthy()
    expect(screen.getByText("4,9 · 12 calificaciones")).toBeTruthy()
    expect(screen.getByText("caro.sanchez@gmail.com")).toBeTruthy()
    expect(screen.getAllByText("#MOVO-48176").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Güemes → Cofico").length).toBeGreaterThan(0)
    expect(screen.getByText("SOP-0900", { exact: false })).toBeTruthy()
    expect(screen.queryByText(/Calificó la atención/)).toBeNull()
  })

  it("el envío vinculado abre su detalle en Envíos (MOVO-326)", () => {
    setup({ status: "ready", data: userContext() })
    const link = screen.getByRole("link", { name: /Abrir en Envíos/ })
    expect(link.getAttribute("href")).toMatch(/^\/shipments\/[^/]+$/)
    expect(screen.queryByText(/llega con la pantalla de Envíos/)).toBeNull()
  })

  it("insignias en null (svc-users caído): avisa en su lugar y muestra el resto", () => {
    setup({ status: "ready", data: userContext({ badges: null }) })
    expect(
      screen.getByText("Verificaciones no disponibles por ahora.")
    ).toBeTruthy()
    expect(screen.getByText("Envíos recientes")).toBeTruthy()
  })

  it("estados vacíos", () => {
    setup({
      status: "ready",
      data: userContext({ recentShipments: [], otherConversations: [] }),
    })
    expect(screen.getByText("Todavía no tiene envíos.")).toBeTruthy()
    expect(screen.getByText("Es su primera consulta.")).toBeTruthy()
  })

  it("error de la sección: se ve en su lugar, con reintento, y el resto del panel sigue", () => {
    const { onRetry } = setup({ status: "error" })
    expect(screen.getByRole("alert").textContent).toContain(
      "No pudimos cargar la ficha del usuario"
    )
    expect(screen.getByText("Carolina Sánchez")).toBeTruthy()
    expect(screen.getByText("Etiquetas")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }))
    expect(onRetry).toHaveBeenCalled()
  })

  it("quitar una etiqueta y desvincular el envío mandan el PATCH", () => {
    const { onPatch } = setup({ status: "ready", data: userContext() })
    fireEvent.click(
      screen.getByRole("button", { name: "Quitar etiqueta Disputa" })
    )
    expect(onPatch).toHaveBeenCalledWith({ tags: [] })
    fireEvent.click(screen.getByRole("button", { name: "Desvincular" }))
    expect(onPatch).toHaveBeenCalledWith({ shipmentId: null })
  })

  it("cargando: esqueleto y el nombre ya visible", () => {
    setup({ status: "loading" })
    expect(screen.getByText("Carolina Sánchez")).toBeTruthy()
    expect(document.querySelector("[aria-busy]")).toBeTruthy()
  })
})

describe("ficha del usuario", () => {
  it("enlaza a la ficha de detalle del usuario", () => {
    setup({ status: "loading" })
    expect(
      screen
        .getByRole("link", { name: /Ver ficha del usuario/ })
        .getAttribute("href")
    ).toBe(`/users/${conversation().user.id}`)
  })
})
