import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

vi.mock("@/app/users/[id]/account-actions", () => ({
  addNote: vi.fn(),
  loadNotesMore: vi.fn(),
}))

import { NotesPanel } from "./notes-panel"
import { FichaProvider } from "../ficha-status"

afterEach(cleanup)

describe("notas de la ficha", () => {
  it("deshabilita agregar notas en la cuenta propia", () => {
    render(
      <FichaProvider>
        <NotesPanel
          userId="7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e5f6"
          fullName="Ada Admin"
          initial={{ items: [], nextCursor: null }}
          isSelf
        />
      </FichaProvider>
    )
    expect(screen.getByRole("button", { name: "Agregar nota" })).toBeDisabled()
  })

  it("habilita agregar notas a otras cuentas", () => {
    render(
      <FichaProvider>
        <NotesPanel
          userId="7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e5f6"
          fullName="Marcos Vera"
          initial={{ items: [], nextCursor: null }}
          isSelf={false}
        />
      </FichaProvider>
    )
    expect(screen.getByRole("button", { name: "Agregar nota" })).toBeEnabled()
  })
})
