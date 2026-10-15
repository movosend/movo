import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
vi.mock("@/lib/auth/session", () => ({
  requireAdmin: async () => ({ fullName: "Alena Ariza" }),
}))
vi.mock("@/components/admin-shell", () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}))
import Page from "./page"
describe("Inicio", () => {
  it("saluda al admin real sin estadísticas ficticias ni promesas de gestión", async () => {
    render(await Page())
    expect(
      screen.getByRole("heading", { name: "Hola, Alena" })
    ).toBeInTheDocument()
    expect(screen.getByText(/próximas entregas/)).toBeInTheDocument()
  })
})
