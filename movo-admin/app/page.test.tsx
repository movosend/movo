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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/reports/api", () => ({
  getOverview: async () => {
    throw new Error("svc-admin caído")
  },
}))
import Page from "./page"

describe("Inicio", () => {
  it("si el resumen no responde, cada bandeja muestra el error con su reintento", async () => {
    render(await Page())
    expect(screen.getByRole("heading", { name: "Inicio" })).toBeInTheDocument()
    expect(screen.getAllByText("No pudimos cargar esta bandeja")).toHaveLength(
      8
    )
    expect(screen.getAllByRole("button", { name: /Reintentar/ })).toHaveLength(
      8
    )
  })
})
