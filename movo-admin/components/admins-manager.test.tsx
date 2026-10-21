import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
const actions = vi.hoisted(() => ({
  revokeAdmin: vi.fn(async () => ({
    error:
      "No se puede revocar al último admin: el panel quedaría sin administradores.",
  })),
  searchCandidates: vi.fn<(query: string) => Promise<unknown[]>>(
    async () => []
  ),
  startGrant: vi.fn(async () => ({
    codeSentTo: "a***@movo.test",
    resendAt: Date.now() + 30_000,
  })),
  confirmGrant: vi.fn(async () => ({ done: "Ana Paz" })),
  resendGrantCode: vi.fn(async () => ({})),
  cancelGrant: vi.fn(async () => undefined),
}))
vi.mock("@/app/admins/actions", () => actions)
import { AdminsManager } from "./admins-manager"

const admins = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    fullName: "Ada Admin",
    email: "ada@movo.test",
    photoUrl: null,
    suspended: false,
    since: "1 de octubre de 2026",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    fullName: "Bruno Baez",
    email: "bruno@movo.test",
    photoUrl: null,
    suspended: false,
    since: "5 de octubre de 2026",
  },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ana = {
  id: "33333333-3333-3333-3333-333333333333",
  fullName: "Ana Paz",
  email: "ana@movo.test",
  photoUrl: "https://cdn.movo.test/ana.jpg",
  status: "active",
  emailVerified: true,
  isAdmin: false,
}

describe("gestión de admins", () => {
  it("lista nombre, email y desde cuándo, sin acción de revocar sobre uno mismo", () => {
    render(<AdminsManager admins={admins} currentUserId={admins[0].id} />)
    expect(screen.getByText("bruno@movo.test")).toBeInTheDocument()
    expect(screen.getByText("5 de octubre de 2026")).toBeInTheDocument()
    expect(screen.getByText("Vos")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Revocar el rol de Ada Admin" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Revocar el rol de Bruno Baez" })
    ).toBeInTheDocument()
  })

  it("la confirmación explica la consecuencia y exige motivo", async () => {
    render(<AdminsManager admins={admins} currentUserId={admins[0].id} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Revocar el rol de Bruno Baez" })
    )
    expect(
      await screen.findByText(/Se cierra su sesión en el panel de inmediato/)
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Motivo/)).toBeRequired()
    expect(
      screen.getByRole("button", { name: "Revocar acceso" })
    ).toBeDisabled()
  })

  it("muestra el motivo concreto del rechazo, no un error genérico", async () => {
    render(<AdminsManager admins={admins} currentUserId={admins[0].id} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Revocar el rol de Bruno Baez" })
    )
    fireEvent.change(await screen.findByLabelText(/Motivo/), {
      target: { value: "Dejó el equipo" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Revocar acceso" }))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("último admin")
    )
  })

  it("al cancelar y reabrir no reaparece el error del intento anterior", async () => {
    render(<AdminsManager admins={admins} currentUserId={admins[0].id} />)
    const open = () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Revocar el rol de Bruno Baez" })
      )
    open()
    fireEvent.change(await screen.findByLabelText(/Motivo/), {
      target: { value: "Dejó el equipo" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Revocar acceso" }))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("último admin")
    )
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
    open()
    await screen.findByLabelText(/Motivo/)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("agregar: autocompleta por nombre, pide la contraseña y después el código", async () => {
    actions.searchCandidates.mockResolvedValue([ana])
    render(<AdminsManager admins={admins} currentUserId={admins[0].id} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Agregar administrador" })
    )
    const input = await screen.findByRole("combobox")
    fireEvent.change(input, { target: { value: "ana" } })
    const option = await screen.findByRole("option", {}, { timeout: 2000 })
    expect(option).toHaveTextContent("ana@movo.test")
    expect(actions.searchCandidates).toHaveBeenCalledWith("ana")
    fireEvent.mouseDown(option)
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    fireEvent.change(await screen.findByLabelText("Tu contraseña"), {
      target: { value: "secreta" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }))
    await waitFor(() => expect(actions.startGrant).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/código de 6 dígitos/)).toHaveTextContent(
      "a***@movo.test"
    )
    expect(
      screen.getByRole("button", { name: "Otorgar acceso" })
    ).toBeDisabled()
  })

  it("quien ya es admin o no verificó el email aparece pero no se puede elegir", async () => {
    actions.searchCandidates.mockResolvedValue([
      { ...ana, isAdmin: true },
      {
        ...ana,
        id: "44444444-4444-4444-4444-444444444444",
        emailVerified: false,
      },
    ])
    render(<AdminsManager admins={admins} currentUserId={admins[0].id} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Agregar administrador" })
    )
    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "ana" },
    })
    const options = await screen.findAllByRole("option", {}, { timeout: 2000 })
    expect(options[0]).toHaveTextContent("Ya es administrador")
    expect(options[1]).toHaveTextContent("Email sin verificar")
    fireEvent.mouseDown(options[0])
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled()
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
