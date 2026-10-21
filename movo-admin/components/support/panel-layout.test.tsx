import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PanelProvider, ResizeHandle, usePanels } from "./panel-layout"
import { DEFAULT_PANELS, LIST_LIMITS } from "@/lib/support/panels"

function Probe() {
  const { state, toggle } = usePanels()
  return (
    <>
      <output data-testid="state">{JSON.stringify(state)}</output>
      <button onClick={() => toggle("list")}>toggle</button>
    </>
  )
}
const setup = () =>
  render(
    <PanelProvider initial={DEFAULT_PANELS}>
      <div style={{ position: "relative" }}>
        <ResizeHandle side="list" label="Ancho de la lista" />
      </div>
      <Probe />
    </PanelProvider>
  )
const read = () => JSON.parse(screen.getByTestId("state").textContent!)
const handle = () =>
  screen.getByRole("separator", { name: "Ancho de la lista" })

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: true,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  document.cookie = "support_panels=; max-age=0; path=/"
})
afterEach(cleanup)

describe("separador redimensionable", () => {
  it("expone el rango y el valor para lectores de pantalla", () => {
    setup()
    expect(handle().getAttribute("aria-valuenow")).toBe(
      String(LIST_LIMITS.default)
    )
    expect(handle().getAttribute("aria-valuemin")).toBe(String(LIST_LIMITS.min))
    expect(handle().getAttribute("aria-valuemax")).toBe(String(LIST_LIMITS.max))
  })

  it("las flechas cambian el ancho de a 16 px, Shift de a 48, y respetan los límites", () => {
    setup()
    fireEvent.keyDown(handle(), { key: "ArrowRight" })
    expect(read().list).toBe(LIST_LIMITS.default + 16)
    fireEvent.keyDown(handle(), { key: "ArrowLeft", shiftKey: true })
    expect(read().list).toBe(LIST_LIMITS.default - 32)
    fireEvent.keyDown(handle(), { key: "End" })
    expect(read().list).toBe(LIST_LIMITS.max)
    fireEvent.keyDown(handle(), { key: "ArrowRight" })
    expect(read().list).toBe(LIST_LIMITS.max)
    fireEvent.keyDown(handle(), { key: "Home" })
    expect(read().list).toBe(LIST_LIMITS.min)
  })

  it("doble clic restablece el ancho y Enter colapsa", () => {
    setup()
    fireEvent.keyDown(handle(), { key: "End" })
    fireEvent.doubleClick(handle())
    expect(read().list).toBe(LIST_LIMITS.default)
    fireEvent.keyDown(handle(), { key: "Enter" })
    expect(read().listCollapsed).toBe(true)
    expect(screen.queryByRole("separator")).toBeNull()
  })

  it("recuerda el tamaño en una cookie", () => {
    setup()
    fireEvent.keyDown(handle(), { key: "ArrowRight" })
    expect(decodeURIComponent(document.cookie)).toContain(
      `"list":${LIST_LIMITS.default + 16}`
    )
  })

  it("expandir una columna colapsada la deja visible", () => {
    setup()
    fireEvent.click(screen.getByText("toggle"))
    expect(read().listCollapsed).toBe(true)
    fireEvent.click(screen.getByText("toggle"))
    expect(read().listCollapsed).toBe(false)
  })
})
