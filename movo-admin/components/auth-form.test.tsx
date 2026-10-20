import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
const actions = vi.hoisted(() => ({
  login: vi.fn(async () => ({ error: "No pudimos verificar los datos." })),
  verify: vi.fn(async () => ({})),
  resend: vi.fn(async () => ({ notice: "Te enviamos un nuevo código." })),
  changeAccount: vi.fn(async () => {}),
}))
vi.mock("@/app/login/actions", () => actions)
vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button>Cambiar tema</button>,
}))
import { AuthForm } from "./auth-form"
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
describe("acceso al panel", () => {
  it("tiene campos accesibles y validación nativa", () => {
    render(<AuthForm />)
    const identifier = screen.getByLabelText("Email")
    expect(identifier).toHaveAttribute("name", "identifier")
    expect(identifier).toHaveAttribute("type", "email")
    expect(identifier).toBeRequired()
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute(
      "autocomplete",
      "current-password"
    )
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled()
  })
  it("muestra un error del servidor sin exponer credenciales", async () => {
    render(<AuthForm />)
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "test@movo.test" },
    })
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "secret" },
    })
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
    expect(
      await screen.findByText("No pudimos verificar los datos.")
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Contraseña")).toHaveValue("")
  })
  it("deshabilita el formulario mientras está pendiente", async () => {
    let resolve!: (value: { error: string }) => void
    actions.login.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    render(<AuthForm />)
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!)
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Verificando…" })
      ).toBeDisabled()
    )
    expect(screen.getByLabelText("Contraseña")).toBeDisabled()
    resolve({ error: "Reintentá" })
    await screen.findByText("Reintentá")
  })
  it("OTP permite pegar los seis dígitos y habilita Verificar", async () => {
    render(<AuthForm challenge={{ email: "a***@movo.test", resendAt: 0 }} />)
    const input = screen.getByLabelText("Código de verificación")
    expect(screen.getByRole("button", { name: "Verificar" })).toBeDisabled()
    fireEvent.focus(input)
    fireEvent.paste(input, { clipboardData: { getData: () => "123456" } })
    await waitFor(() => expect(input).toHaveValue("123456"))
    expect(screen.getByRole("button", { name: "Verificar" })).toBeEnabled()
    expect(input).toHaveAttribute("autocomplete", "one-time-code")
  })
  it("la pestaña Teléfono cambia el campo, el placeholder y muestra la bandera", () => {
    render(<AuthForm />)
    fireEvent.click(screen.getByRole("tab", { name: "Teléfono" }))
    const phone = screen.getByLabelText("Teléfono")
    expect(phone).toHaveAttribute("type", "tel")
    expect(phone).toHaveAttribute("placeholder", "351 123 4567")
    expect(screen.getByText(/🇦🇷/)).toBeInTheDocument()
  })
  it("el botón del ojo alterna la visibilidad de la contraseña", () => {
    render(<AuthForm />)
    const password = screen.getByLabelText("Contraseña")
    expect(password).toHaveAttribute("type", "password")
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }))
    expect(password).toHaveAttribute("type", "text")
    fireEvent.click(screen.getByRole("button", { name: "Ocultar contraseña" }))
    expect(password).toHaveAttribute("type", "password")
  })
  it("enlaza a la recuperación de contraseña", () => {
    render(<AuthForm />)
    expect(
      screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" })
    ).toHaveAttribute("href", "/forgot")
  })
  it("muestra el cooldown recibido y la acción de cambiar de cuenta", async () => {
    render(
      <AuthForm
        challenge={{ email: "a***@movo.test", resendAt: Date.now() + 60000 }}
      />
    )
    expect(screen.getByText(/Podés pedir otro en/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Usar otra cuenta" }))
    await waitFor(() => expect(actions.changeAccount).toHaveBeenCalled())
  })
})
