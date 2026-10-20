import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
vi.mock("@/lib/auth/session", () => ({
  requireAdmin: async () => ({ fullName: "Alena Ariza", email: "a@movo.test" }),
}))
vi.mock("@/lib/sidebar", () => ({ sidebarDefaultOpen: async () => true }))
vi.mock("@/components/admin-shell", () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}))
import Page from "./page"
describe("Inicio", () => {
  it("saluda al admin real y marca como próximas las secciones sin construir", async () => {
    render(await Page())
    expect(
      screen.getByRole("heading", { name: "Hola, Alena." })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Admins/ })).toHaveAttribute(
      "href",
      "/admins"
    )
    expect(screen.getByRole("link", { name: /Usuarios/ })).toHaveAttribute(
      "href",
      "/users"
    )
    expect(screen.getAllByText("Próximamente")).toHaveLength(6)
  })
})
