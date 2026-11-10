import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"

const actions = vi.hoisted(() => ({ decideKyc: vi.fn() }))
vi.mock("@/app/kyc/actions", () => actions)

import type { AdminKycReviewRow } from "@movo/shared/src/types/admin-kyc"
import { DecisionPanel } from "./decision-panel"
import { KycRows } from "./review-table"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const row = (over: Partial<AdminKycReviewRow> = {}): AdminKycReviewRow => ({
  sessionId: "sess-1",
  userId: "7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e5f6",
  fullName: "Marcos Vera",
  photoUrl: null,
  verificationType: "identity",
  reason: "Documento borroso",
  requestedAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  // Entró a revisión un día después de abrir la sesión: la espera se cuenta desde acá.
  inReviewSince: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  ...over,
})

describe("cola de KYC", () => {
  it("cada fila lleva al caso y muestra tipo, motivo y la espera desde que entró a revisión", () => {
    render(<KycRows rows={[row()]} filtered={false} />)

    const link = screen.getByRole("link", { name: /Marcos Vera/ })
    expect(link).toHaveAttribute("href", "/kyc/sess-1")
    expect(screen.getAllByText(/Identidad/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Documento borroso/).length).toBeGreaterThan(0)
    expect(screen.getByText("hace 5 días")).toBeInTheDocument()
  })

  it("un caso sin motivo legible lo dice", () => {
    render(<KycRows rows={[row({ reason: null })]} filtered={false} />)

    expect(screen.getByText(/Sin detalle/)).toBeInTheDocument()
  })

  it("sin casos: 'no hay verificaciones para revisar'; con filtro: 'ningún caso coincide'", () => {
    const { rerender } = render(<KycRows rows={[]} filtered={false} />)
    expect(
      screen.getByText("No hay verificaciones para revisar")
    ).toBeInTheDocument()

    rerender(<KycRows rows={[]} filtered />)
    expect(screen.getByText("Ningún caso coincide")).toBeInTheDocument()
  })
})

describe("DecisionPanel", () => {
  const props = {
    sessionId: "sess-1",
    fullName: "Marcos Vera",
    firstName: "Marcos",
    lastName: "Vera",
    verificationType: "identity" as const,
    decidable: true,
  }

  it("aprobar pide un motivo de al menos 10 caracteres y confirma", async () => {
    actions.decideKyc.mockResolvedValue({
      ok: true,
      data: { sessionId: "sess-1", status: "approved" },
    })
    render(<DecisionPanel {...props} />)

    fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }))
    const confirm = await screen.findByRole("button", { name: "Aprobar" })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Motivo/), {
      target: { value: "corto" },
    })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Motivo/), {
      target: { value: "El documento y la selfie coinciden" },
    })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(actions.decideKyc).toHaveBeenCalledWith(
        "sess-1",
        "approved",
        "El documento y la selfie coinciden"
      )
    )
    expect(await screen.findByText("Quedó aprobada")).toBeInTheDocument()
  })

  it("aprobar una identidad muestra el nombre que leyó Didit, y si no se toca no lo manda", async () => {
    actions.decideKyc.mockResolvedValue({ ok: true, data: { sessionId: "sess-1", status: "approved" } })
    render(<DecisionPanel {...props} />)

    fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }))
    expect(await screen.findByLabelText("Nombre")).toHaveValue("Marcos")
    expect(screen.getByLabelText("Apellido")).toHaveValue("Vera")
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "El documento y la selfie coinciden" } })
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }))

    await waitFor(() =>
      expect(actions.decideKyc).toHaveBeenCalledWith("sess-1", "approved", "El documento y la selfie coinciden")
    )
  })

  it("el admin puede corregir el nombre al aprobar: se manda corregido", async () => {
    actions.decideKyc.mockResolvedValue({ ok: true, data: { sessionId: "sess-1", status: "approved" } })
    render(<DecisionPanel {...props} />)

    fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }))
    fireEvent.change(await screen.findByLabelText("Apellido"), { target: { value: "Vera Núñez" } })
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "El documento y la selfie coinciden" } })
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }))

    await waitFor(() =>
      expect(actions.decideKyc).toHaveBeenCalledWith("sess-1", "approved", "El documento y la selfie coinciden", {
        firstName: "Marcos",
        lastName: "Vera Núñez",
      })
    )
  })

  it("si Didit no leyó el nombre, hay que escribirlo para poder aprobar", async () => {
    render(<DecisionPanel {...props} firstName="" lastName="" />)

    fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }))
    fireEvent.change(await screen.findByLabelText(/Motivo/), { target: { value: "El documento y la selfie coinciden" } })
    const confirm = screen.getByRole("button", { name: "Aprobar" })
    expect(confirm).toBeDisabled()
    expect(screen.getByText(/Didit no pudo leerlo/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Marcos" } })
    fireEvent.change(screen.getByLabelText("Apellido"), { target: { value: "Vera" } })
    expect(confirm).toBeEnabled()
  })

  it("al rechazar o decidir una licencia no se pide el nombre", async () => {
    const { unmount } = render(<DecisionPanel {...props} />)
    fireEvent.click(screen.getByRole("button", { name: /Rechazar/ }))
    await screen.findByLabelText(/Motivo/)
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument()
    unmount()

    render(<DecisionPanel {...props} verificationType="license" />)
    fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }))
    await screen.findByLabelText(/Motivo/)
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument()
  })

  it("rechazar manda la decisión 'rejected'", async () => {
    actions.decideKyc.mockResolvedValue({
      ok: true,
      data: { sessionId: "sess-1", status: "rejected" },
    })
    render(<DecisionPanel {...props} />)

    fireEvent.click(screen.getByRole("button", { name: /Rechazar/ }))
    fireEvent.change(await screen.findByLabelText(/Motivo/), {
      target: { value: "El documento está vencido" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }))

    await waitFor(() =>
      expect(actions.decideKyc).toHaveBeenCalledWith(
        "sess-1",
        "rejected",
        "El documento está vencido"
      )
    )
    expect(await screen.findByText("Quedó rechazada")).toBeInTheDocument()
  })

  it("si la acción falla muestra el error dentro del diálogo y deja reintentar", async () => {
    actions.decideKyc.mockResolvedValue({
      ok: false,
      error: "Este caso ya no está en revisión.",
    })
    render(<DecisionPanel {...props} />)

    fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }))
    fireEvent.change(await screen.findByLabelText(/Motivo/), {
      target: { value: "El documento y la selfie coinciden" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ya no está en revisión"
    )
    // La transición termina un instante después del error: el botón vuelve a estar disponible.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Aprobar" })).toBeEnabled()
    )
  })

  it("la tecla A abre aprobar y la D abre rechazar", async () => {
    render(<DecisionPanel {...props} />)

    fireEvent.keyDown(window, { key: "a" })
    expect(await screen.findByRole("heading", { name: /Aprobar identidad de Marcos Vera/ })).toBeInTheDocument()
    cleanup()

    render(<DecisionPanel {...props} />)
    fireEvent.keyDown(window, { key: "D" })
    expect(await screen.findByRole("heading", { name: /Rechazar identidad de Marcos Vera/ })).toBeInTheDocument()
  })

  it("los atajos no se disparan mientras se escribe ni con un modificador", () => {
    render(
      <>
        <input aria-label="buscar" />
        <DecisionPanel {...props} />
      </>
    )

    fireEvent.keyDown(screen.getByLabelText("buscar"), { key: "a" })
    fireEvent.keyDown(window, { key: "a", metaKey: true })

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("deja claro cuántos caracteres faltan y por qué el botón está apagado", async () => {
    render(<DecisionPanel {...props} />)

    fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }))
    const field = await screen.findByLabelText(/Motivo/)
    expect(screen.getByText(/mínimo 10 caracteres/)).toBeInTheDocument()
    expect(screen.getByText("Faltan 10 caracteres")).toBeInTheDocument()
    expect(screen.getByText("Escribí el motivo para aprobar")).toBeInTheDocument()
    expect(field).toHaveAttribute("aria-describedby", "kyc-reason-status")

    fireEvent.change(field, { target: { value: "  documento  " } })
    // cuenta sin los espacios de los bordes, como el backend
    expect(screen.getByText("Faltan 1 carácter")).toBeInTheDocument()
    expect(field).toHaveAttribute("aria-invalid", "true")

    fireEvent.change(field, { target: { value: "Documento legible" } })
    expect(screen.queryByText(/Faltan/)).not.toBeInTheDocument()
    expect(screen.getByText("17/500")).toBeInTheDocument()
    expect(screen.queryByText("Escribí el motivo para aprobar")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeEnabled()
  })

  it("la confirmación no se pierde cuando la página se refresca y el caso pasa a resuelto", async () => {
    actions.decideKyc.mockResolvedValue({ ok: true, data: { sessionId: "sess-1", status: "approved" } })
    const { rerender } = render(<DecisionPanel {...props} />)

    fireEvent.click(screen.getByRole("button", { name: /Aprobar/ }))
    fireEvent.change(await screen.findByLabelText(/Motivo/), {
      target: { value: "El documento y la selfie coinciden" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }))
    expect(await screen.findByText("Quedó aprobada")).toBeInTheDocument()

    // Lo que hace el revalidatePath de la action: el caso ya no se puede decidir.
    rerender(<DecisionPanel {...props} decidable={false} />)
    expect(screen.getByText("Quedó aprobada")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Listo" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByText("La aprobaste vos")).toBeInTheDocument()
    expect(screen.queryByText(/ya no se puede decidir/)).not.toBeInTheDocument()
  })

  it("un caso que ya no se puede decidir no muestra botones ni responde a los atajos", () => {
    render(<DecisionPanel {...props} decidable={false} />)

    expect(screen.queryByRole("button", { name: /Aprobar/ })).not.toBeInTheDocument()
    expect(screen.getByText(/ya no se puede decidir/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: "a" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
