import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
const actions = vi.hoisted(() => ({
  grantAdmin: vi.fn(async () => ({
    error:
      "Esa cuenta no verificó su email. Tiene que hacerlo antes de ser admin.",
  })),
  revokeAdmin: vi.fn(async () => ({
    error:
      "No se puede revocar al último admin: el panel quedaría sin administradores.",
  })),
}))
vi.mock("@/app/admins/actions", () => actions)
import { AdminsManager } from "./admins-manager"

const admins = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    fullName: "Ada Admin",
    email: "ada@movo.test",
    suspended: false,
    since: "1 de octubre de 2026",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    fullName: "Bruno Baez",
    email: "bruno@movo.test",
    suspended: false,
    since: "5 de octubre de 2026",
  },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("gestión de admins", () => {
  it("lista nombre, email y desde cuándo, sin acción de revocar sobre uno mismo", () => {
    render(<AdminsManager admins={admins} currentUserId={admins[0].id} />)
    expect(screen.getByText("bruno@movo.test")).toBeInTheDocument()
    expect(screen.getByText(/Admin desde 5 de octubre/)).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Revocar el rol de Ada Admin" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Revocar el rol de Bruno Baez" })
    ).toBeInTheDocument()
  })

  it("la confirmación explica la consecuencia y exige motivo", () => {
    render(<AdminsManager admins={admins} currentUserId={admins[0].id} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Revocar el rol de Bruno Baez" })
    )
    expect(
      screen.getByText(/se cierra su sesión en el panel de inmediato/)
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Motivo")).toBeRequired()
  })

  it("muestra el motivo concreto del rechazo, no un error genérico", async () => {
    render(<AdminsManager admins={admins} currentUserId={admins[0].id} />)
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nuevo@movo.test" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Otorgar rol" }))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "no verificó su email"
      )
    )
  })

  it("muestra el error de carga de la lista", () => {
    render(
      <AdminsManager
        admins={[]}
        currentUserId="x"
        loadError="Movo no está disponible."
      />
    )
    expect(screen.getByText("Movo no está disponible.")).toBeInTheDocument()
  })
})
