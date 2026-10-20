import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"

const actions = vi.hoisted(() => ({
  revokeSessions: vi.fn(),
  updateContact: vi.fn(),
  adjustLedger: vi.fn(),
  addNote: vi.fn(),
}))
vi.mock("@/app/users/[id]/account-actions", () => actions)

import type { AdminUserProfile } from "@movo/shared/src/types/admin-users"
import { FichaProvider, ReportSection } from "../ficha-status"
import { AccountActions } from "./account-actions"
import { ContactDialog } from "./contact-dialog"
import { LedgerDialog } from "./ledger-dialog"
import { NoteDialog } from "./note-dialog"
import { SessionsDialog } from "./sessions-dialog"

const user = (over: Partial<AdminUserProfile> = {}): AdminUserProfile => ({
  id: "7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e5f6",
  firstName: "Marcos",
  lastName: "Vera",
  fullName: "Marcos Vera",
  email: "marcos.vera@gmail.com",
  emailVerified: true,
  phone: "+5493516124410",
  phoneVerified: true,
  dni: "33812405",
  birthdate: "1988-04-18",
  photoUrl: null,
  createdAt: "2025-11-03T15:00:00.000Z",
  deletedAt: null,
  roles: [{ role: "sender", grantedAt: "2025-11-03T15:00:00.000Z" }],
  accountStatus: "active",
  bannedUntil: null,
  ...over,
})

afterEach(() => {
  cleanup()
  for (const fn of Object.values(actions)) fn.mockReset()
})

const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe("menú de acciones", () => {
  const open = () =>
    fireEvent.click(screen.getByRole("button", { name: /Acciones/ }))

  it("lista las acciones y deja las sanciones deshabilitadas hasta MOVO-299", async () => {
    render(<AccountActions user={user()} />)
    open()
    for (const name of [
      "Cambiar el email",
      "Cambiar el teléfono",
      "Cerrar todas las sesiones",
      "Ajustar el saldo",
      "Agregar nota interna",
    ])
      expect(await screen.findByRole("menuitem", { name })).not.toHaveAttribute(
        "aria-disabled",
        "true"
      )
    expect(
      screen.getByRole("menuitem", { name: /Suspender o inhabilitar/ })
    ).toHaveAttribute("aria-disabled", "true")
  })

  it("en la propia cuenta no permite ninguna acción y lo explica", async () => {
    render(<AccountActions user={user()} isSelf />)
    open()
    expect(
      await screen.findByText("No podés actuar sobre tu propia cuenta.")
    ).toBeInTheDocument()
    for (const name of ["Cambiar el email", "Agregar nota interna"])
      expect(screen.getByRole("menuitem", { name })).toHaveAttribute(
        "aria-disabled",
        "true"
      )
  })

  it("con la cuenta eliminada solo admite notas", async () => {
    render(<AccountActions user={user({ accountStatus: "deleted" })} />)
    open()
    expect(await screen.findByText(/solo admite notas/)).toBeInTheDocument()
    expect(
      screen.getByRole("menuitem", { name: "Cambiar el email" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByRole("menuitem", { name: "Agregar nota interna" })
    ).not.toHaveAttribute("aria-disabled", "true")
  })

  it("elegir una acción abre su diálogo", async () => {
    render(<AccountActions user={user()} />)
    open()
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Cambiar el teléfono" })
    )
    expect(
      await screen.findByRole("dialog", { name: "Cambiar el teléfono" })
    ).toBeInTheDocument()
  })
})

describe("cambiar email o teléfono", () => {
  const mount = (field: "email" | "phone" = "email", onClose = vi.fn()) =>
    render(<ContactDialog field={field} onClose={onClose} user={user()} />)

  const fillEmail = (value = "nuevo@gmail.com") => {
    type("Email nuevo", value)
    type("Motivo", "Pidió el cambio por soporte")
  }

  it("no deja revisar sin valor válido, distinto al actual y con motivo", async () => {
    mount()
    const review = await screen.findByRole("button", {
      name: "Revisar cambio",
    })
    expect(review).toBeDisabled()
    type("Email nuevo", "no-es-email")
    type("Motivo", "x")
    expect(review).toBeDisabled()
    type("Email nuevo", "MARCOS.VERA@gmail.com")
    expect(screen.getByText(/Es el mismo email/)).toBeInTheDocument()
    expect(review).toBeDisabled()
    type("Email nuevo", "nuevo@gmail.com")
    expect(review).toBeEnabled()
  })

  it("muestra antes y después y no confirma sin tildar el aviso", async () => {
    mount()
    fillEmail()
    fireEvent.click(screen.getByRole("button", { name: "Revisar cambio" }))
    // El valor viejo aparece tachado y otra vez en el aviso al email anterior.
    expect(
      (await screen.findAllByText("marcos.vera@gmail.com")).length
    ).toBeGreaterThan(0)
    expect(screen.getByText("nuevo@gmail.com")).toBeInTheDocument()
    expect(
      screen.getByText(/Se cierran todas sus sesiones/)
    ).toBeInTheDocument()
    const confirm = screen.getByRole("button", { name: "Cambiar email" })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox"))
    expect(confirm).toBeEnabled()
    expect(actions.updateContact).not.toHaveBeenCalled()
  })

  it("el teléfono se muestra normalizado y avisa del KYC", async () => {
    mount("phone")
    type("Teléfono nuevo", "0351 612 9999")
    expect(
      screen.getByText(/Se guarda como \+54 9 351 612-9999/)
    ).toBeInTheDocument()
    type("Motivo", "Cambió de número")
    fireEvent.click(screen.getByRole("button", { name: "Revisar cambio" }))
    expect(
      await screen.findByText(/no puede iniciar la verificación de identidad/)
    ).toBeInTheDocument()
  })

  it("confirma con lo que vio como valor actual y cierra con el resultado", async () => {
    actions.updateContact.mockResolvedValue({
      ok: true,
      data: {
        email: "nuevo@gmail.com",
        emailVerified: false,
        phone: "+5493516124410",
        phoneVerified: true,
        revokedRefreshTokens: 2,
      },
    })
    const onClose = vi.fn()
    mount("email", onClose)
    fillEmail()
    fireEvent.click(screen.getByRole("button", { name: "Revisar cambio" }))
    fireEvent.click(await screen.findByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Cambiar email" }))
    await screen.findByText("Email actualizado")
    expect(actions.updateContact).toHaveBeenCalledWith(user().id, {
      field: "email",
      newValue: "nuevo@gmail.com",
      expectedCurrent: "marcos.vera@gmail.com",
      reason: "Pidió el cambio por soporte",
    })
    expect(screen.getByText(/Queda sin verificar/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Listo" }))
    expect(onClose).toHaveBeenCalled()
  })

  it("si el dato cambió mientras tanto, solo deja cerrar", async () => {
    actions.updateContact.mockResolvedValue({
      ok: false,
      error: "El dato cambió mientras lo editabas.",
      code: "CONTACT_CHANGED",
      status: 409,
    })
    mount()
    fillEmail()
    fireEvent.click(screen.getByRole("button", { name: "Revisar cambio" }))
    fireEvent.click(await screen.findByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Cambiar email" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /cambió mientras/
    )
    expect(screen.queryByRole("button", { name: "Cambiar email" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Volver" })).toBeNull()
    expect(screen.getAllByRole("button", { name: "Cerrar" })).toHaveLength(2)
  })

  it("otro error deja volver a editar", async () => {
    actions.updateContact.mockResolvedValue({
      ok: false,
      error: "Ese email ya pertenece a otra cuenta.",
      code: "EMAIL_ALREADY_IN_USE",
      status: 409,
    })
    mount()
    fillEmail()
    fireEvent.click(screen.getByRole("button", { name: "Revisar cambio" }))
    fireEvent.click(await screen.findByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Cambiar email" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/otra cuenta/)
    fireEvent.click(screen.getByRole("button", { name: "Volver" }))
    expect(await screen.findByLabelText("Email nuevo")).toHaveValue(
      "nuevo@gmail.com"
    )
  })
})

describe("cerrar sesiones", () => {
  it("pide motivo y manda la acción", async () => {
    actions.revokeSessions.mockResolvedValue({
      ok: true,
      data: { revokedRefreshTokens: 3 },
    })
    render(
      <SessionsDialog
        open
        onClose={vi.fn()}
        userId={user().id}
        fullName="Marcos Vera"
      />
    )
    const submit = await screen.findByRole("button", {
      name: "Cerrar sesiones",
    })
    expect(submit).toBeDisabled()
    type("Motivo", "Celular robado")
    fireEvent.click(submit)
    await screen.findByText("Sesiones cerradas")
    expect(actions.revokeSessions).toHaveBeenCalledWith(
      user().id,
      "Celular robado"
    )
  })

  it("muestra el error dentro del diálogo", async () => {
    actions.revokeSessions.mockResolvedValue({
      ok: false,
      error: "No podés modificar un registro en el que sos parte.",
    })
    render(
      <SessionsDialog
        open
        onClose={vi.fn()}
        userId={user().id}
        fullName="Marcos Vera"
      />
    )
    type("Motivo", "x")
    fireEvent.click(
      await screen.findByRole("button", { name: "Cerrar sesiones" })
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(/sos parte/)
  })
})

describe("ajustar el saldo", () => {
  const mount = (balanceArs: number | null = 300) =>
    render(
      <FichaProvider>
        {balanceArs !== null && (
          <ReportSection id="cuenta" status="ready" balanceArs={balanceArs} />
        )}
        <LedgerDialog
          open
          onClose={vi.fn()}
          userId={user().id}
          fullName="Marcos Vera"
        />
      </FichaProvider>
    )

  it("sin el saldo cargado no deja revisar", async () => {
    mount(null)
    expect(
      await screen.findByText(/Cargando la cuenta corriente/)
    ).toBeInTheDocument()
    type(/Monto/, "100")
    type("Motivo", "x")
    expect(
      screen.getByRole("button", { name: "Revisar ajuste" })
    ).toBeDisabled()
  })

  it("muestra el saldo resultante según el sentido y envía el monto con signo", async () => {
    actions.adjustLedger.mockResolvedValue({
      ok: true,
      data: {
        entry: {
          id: "e1",
          type: "manual_adjustment",
          amountArs: -300,
          status: "settled",
          shipmentId: null,
          reason: "Cobro de más",
          adminName: "Ada Admin",
          createdAt: "2026-10-19T12:00:00.000Z",
        },
        balanceArs: 0,
      },
    })
    mount(300)
    expect(await screen.findByText("$300")).toBeInTheDocument()
    expect(screen.getByText("Debe")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("radio", { name: /Debe menos/ }))
    // Con el monto a medio escribir ya se ve cómo queda el saldo.
    type(/Monto/, "100")
    expect(screen.getByText("Debe $200")).toBeInTheDocument()
    type(/Monto/, "300")
    type("Motivo", "Cobro de más")
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }))
    expect(await screen.findByText("−$300")).toBeInTheDocument()
    expect(screen.getByText("Al día")).toBeInTheDocument()
    const confirm = screen.getByRole("button", { name: "Registrar ajuste" })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(confirm)
    await screen.findByText("Ajuste registrado")
    expect(actions.adjustLedger).toHaveBeenCalledWith(user().id, {
      amountArs: -300,
      reason: "Cobro de más",
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
  })

  it("los montos rápidos completan el campo y se ve cómo queda el saldo", async () => {
    mount(0)
    await screen.findByText("Al día")
    fireEvent.click(screen.getByRole("button", { name: "$1.000" }))
    expect(screen.getByLabelText(/Monto/)).toHaveValue("1.000")
    expect(screen.getAllByText("Debe $1.000").length).toBeGreaterThan(0)
  })

  it("reintenta con la misma clave si el servicio no respondió y con otra si lo rechazó", async () => {
    actions.adjustLedger
      .mockResolvedValueOnce({ ok: false, error: "caído", unconfirmed: true })
      .mockResolvedValueOnce({ ok: false, error: "rechazado", status: 422 })
      .mockResolvedValueOnce({ ok: false, error: "otra", status: 422 })
    mount(0)
    await screen.findByText("Al día")
    type(/Monto/, "50")
    type("Motivo", "Cobro que faltó")
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }))
    fireEvent.click(await screen.findByRole("checkbox"))
    const confirm = screen.getByRole("button", { name: "Registrar ajuste" })
    fireEvent.click(confirm)
    await waitFor(() => expect(actions.adjustLedger).toHaveBeenCalledTimes(1))
    await screen.findByText("caído")
    fireEvent.click(confirm)
    await waitFor(() => expect(actions.adjustLedger).toHaveBeenCalledTimes(2))
    await screen.findByText("rechazado")
    fireEvent.click(confirm)
    await waitFor(() => expect(actions.adjustLedger).toHaveBeenCalledTimes(3))
    const keys = actions.adjustLedger.mock.calls.map((c) => c[1].idempotencyKey)
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[1])
  })
})

describe("nota interna", () => {
  it("guarda la nota y cierra", async () => {
    actions.addNote.mockResolvedValue({ ok: true, data: {} })
    const onClose = vi.fn()
    render(
      <NoteDialog
        open
        onClose={onClose}
        userId={user().id}
        fullName="Marcos Vera"
      />
    )
    const save = await screen.findByRole("button", { name: "Guardar nota" })
    expect(save).toBeDisabled()
    type("Nota", "Llamó por la disputa")
    fireEvent.click(save)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(actions.addNote).toHaveBeenCalledWith(
      user().id,
      "Llamó por la disputa"
    )
  })
})
