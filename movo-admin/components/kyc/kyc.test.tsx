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
  requestedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  ...over,
})

describe("cola de KYC", () => {
  it("cada fila lleva al caso y muestra tipo, motivo y la espera", () => {
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
    verificationType: "identity" as const,
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
})
