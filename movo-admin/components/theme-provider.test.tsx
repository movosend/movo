import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"

const theme = vi.hoisted(() => ({ setTheme: vi.fn(), resolvedTheme: "light" }))
vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useTheme: () => theme,
}))

import { ThemeProvider } from "./theme-provider"

afterEach(() => {
  cleanup()
  theme.setTheme.mockClear()
})

describe("atajo de tema", () => {
  it("la tecla D alterna el tema", () => {
    render(<ThemeProvider>contenido</ThemeProvider>)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }))
    expect(theme.setTheme).toHaveBeenCalledWith("dark")
  })

  it("un keydown sin `key` (autocompletado del navegador) no rompe ni cambia el tema", () => {
    render(<ThemeProvider>contenido</ThemeProvider>)
    // Chrome lo dispara como un `Event` común, sin la propiedad `key`. Una excepción en el listener
    // no sale de `dispatchEvent`: jsdom la reporta como evento `error` de `window`.
    const errors: unknown[] = []
    const onError = (e: ErrorEvent) => {
      errors.push(e.error)
      e.preventDefault()
    }
    window.addEventListener("error", onError)
    try {
      window.dispatchEvent(new Event("keydown"))
    } finally {
      window.removeEventListener("error", onError)
    }
    expect(errors).toEqual([])
    expect(theme.setTheme).not.toHaveBeenCalled()
  })

  it("escribiendo en un campo no cambia el tema", () => {
    render(
      <ThemeProvider>
        <input aria-label="campo" />
      </ThemeProvider>
    )
    const input = document.querySelector("input")!
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "d", bubbles: true })
    )
    expect(theme.setTheme).not.toHaveBeenCalled()
  })
})
