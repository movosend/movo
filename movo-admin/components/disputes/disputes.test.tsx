import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => nav }))
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    scroll,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    scroll?: boolean
  }) => {
    void scroll
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
}))
const actions = vi.hoisted(() => ({
  addNote: vi.fn(),
  loadMoreNotes: vi.fn(),
  resolve: vi.fn(),
}))
vi.mock("@/app/disputes/actions", () => actions)

import { DisputeStatus } from "@movo/shared/src/types/dispute"
import type { AdminDisputeResolution } from "@movo/shared/src/types/admin-disputes"
import { MOCK_DISPUTES } from "@/lib/disputes/fixtures"
import { EMPTY_DISPUTE_STATE } from "@/lib/disputes/params"
import { DisputeFilters } from "./dispute-filters"
import { DisputeRowLink } from "./dispute-table"
import { AttributionCard, HandshakeCard } from "./expediente"
import { NotesCard } from "./notes-card"
import { ResolveAction, ResolveNotice } from "./resolve-controls"

const counts = {
  [DisputeStatus.OPEN]: 4,
  [DisputeStatus.RESOLVING]: 1,
  [DisputeStatus.RESOLVED]: 9,
}
const NAMES = { sender: "Florencia", carrier: "Hernán" }
const ID = "d15b07e5-0000-4000-8000-000000000042"

beforeEach(() => {
  Object.values(actions).forEach((fn) => fn.mockReset())
  nav.replace.mockReset()
  nav.refresh.mockReset()
})
afterEach(cleanup)

describe("DisputeFilters", () => {
  const render_ = (state = EMPTY_DISPUTE_STATE) =>
    render(
      <DisputeFilters
        state={state}
        counts={counts}
        resultLabel="4 disputas"
        loadedAt={new Date().toISOString()}
      />
    )

  it("muestra los conteos por estado y marca las abiertas", () => {
    render_()
    const tabs = screen.getAllByRole("tab")
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Abiertas4",
      "Procesando pago1",
      "Resueltas9",
    ])
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true")
  })

  it("la ciudad del retiro se aplica al salir del campo y con Enter, y viaja en la URL", () => {
    render_()
    const city = screen.getByLabelText("Ciudad del retiro")
    fireEvent.change(city, { target: { value: "Villa María" } })
    expect(nav.replace).not.toHaveBeenCalled()
    fireEvent.blur(city)
    expect(nav.replace).toHaveBeenCalledTimes(1)
    expect(nav.replace.mock.calls[0]![0]).toContain("city=Villa+Mar%C3%ADa")

    fireEvent.change(city, { target: { value: "Río Cuarto" } })
    fireEvent.keyDown(city, { key: "Enter" })
    expect(nav.replace).toHaveBeenCalledTimes(2)
    expect(nav.replace.mock.calls[1]![0]).toContain("city=R%C3%ADo+Cuarto")
  })

  it("cambiar de pestaña conserva la ciudad y vuelve a la primera página", () => {
    render_({
      ...EMPTY_DISPUTE_STATE,
      city: "Córdoba",
      cursor: "o25",
      back: [],
    })
    fireEvent.click(screen.getByRole("tab", { name: /Resueltas/ }))
    const href = nav.replace.mock.calls[0]![0] as string
    expect(href).toContain("status=resolved")
    expect(href).toContain("city=C%C3%B3rdoba")
    expect(href).not.toContain("cursor")
  })
})

describe("DisputeRowLink", () => {
  it("diferencia el motivo automático y muestra la ciudad del retiro", () => {
    const system = MOCK_DISPUTES.find(
      (d) => d.detail.openedByRole === null
    )!.detail
    render(<DisputeRowLink row={system} href="/disputes/x" now={new Date()} />)
    expect(screen.getByText("Anomalía en tránsito")).toBeTruthy()
    expect(screen.getAllByText("Sistema").length).toBeGreaterThan(0)
    expect(screen.getAllByText(system.pickupCity!).length).toBeGreaterThan(0)
  })
})

describe("bloques del expediente", () => {
  it("un bloque con error muestra su error y «Reintentar» vuelve a pedir la página", () => {
    render(
      <HandshakeCard
        handshake={{
          data: null,
          error: { code: "SHIPMENTS_SERVICE_UNAVAILABLE", message: "caído" },
        }}
      />
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "No pudimos cargar el handshake."
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "El resto del expediente no se ve afectado."
    )
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }))
    expect(nav.refresh).toHaveBeenCalled()
  })

  it("las disputas del sistema muestran a quién atribuyó el barrido y con qué datos", () => {
    const attribution = MOCK_DISPUTES.find(
      (d) => d.detail.attribution?.reason === "pickup_no_show"
    )!.detail.attribution!
    render(<AttributionCard attribution={attribution} />)
    expect(screen.getByText("Atribuido al emisor")).toBeTruthy()
    expect(screen.getAllByText("Llegó").length).toBe(3)
    expect(screen.getByText("Zona gris")).toBeTruthy()
  })
})

describe("NotesCard", () => {
  const note = {
    id: "n1",
    disputeId: ID,
    adminId: "a",
    adminName: "Tomás Ferreyra",
    body: "Pedir el comprobante del embalaje.",
    createdAt: new Date().toISOString(),
  }

  it("marca las notas como no visibles para los usuarios y agrega una nueva arriba", async () => {
    actions.addNote.mockResolvedValue({
      ok: true,
      data: { ...note, id: "n2", body: "Llamé al receptor." },
    })
    render(
      <NotesCard
        disputeId={ID}
        initial={{ items: [note], nextCursor: null }}
        conflict={false}
      />
    )
    expect(screen.getByText("No visibles para los usuarios")).toBeTruthy()
    const add = screen.getByRole("button", { name: /Agregar nota/ })
    expect((add as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Nueva nota interna"), {
      target: { value: "Llamé al receptor." },
    })
    await act(async () => fireEvent.click(add))
    expect(actions.addNote).toHaveBeenCalledWith(ID, "Llamé al receptor.")
    const items = screen.getAllByRole("listitem")
    expect(items[0]!.textContent).toContain("Llamé al receptor.")
    expect(items[1]!.textContent).toContain("Pedir el comprobante")
  })

  it("un error al guardar queda en el formulario y conserva el borrador", async () => {
    actions.addNote.mockResolvedValue({
      ok: false,
      error: "El servicio no respondió.",
    })
    render(
      <NotesCard
        disputeId={ID}
        initial={{ items: [], nextCursor: null }}
        conflict={false}
      />
    )
    fireEvent.change(screen.getByLabelText("Nueva nota interna"), {
      target: { value: "Una nota" },
    })
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /Agregar nota/ }))
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "El servicio no respondió."
    )
    expect(
      (screen.getByLabelText("Nueva nota interna") as HTMLTextAreaElement).value
    ).toBe("Una nota")
  })

  it("un admin que es parte lee las notas pero no puede escribir", () => {
    render(
      <NotesCard
        disputeId={ID}
        initial={{ items: [note], nextCursor: null }}
        conflict
      />
    )
    expect(screen.queryByLabelText("Nueva nota interna")).toBeNull()
    expect(screen.getByText(/Sos parte de este envío/)).toBeTruthy()
    expect(screen.getByText(/Pedir el comprobante/)).toBeTruthy()
  })
})

describe("resolución", () => {
  // La disputa 41 está `in_transit` al abrirse: hold sin capturar, con piso de captura parcial.
  const open = MOCK_DISPUTES.find((d) => d.detail.id.endsWith("000000000041"))!
  const preview = { data: open.preview, error: null }
  const min = open.preview.minimumPartialArs!

  const renderOpen = () =>
    render(
      <ResolveAction
        disputeId={open.detail.id}
        status={DisputeStatus.OPEN}

        preview={preview}
        names={NAMES}
        conflict={false}
      />
    )
  const openDialog = () => {
    fireEvent.click(screen.getByRole("button", { name: "Resolver disputa" }))
    return screen.getByRole("dialog")
  }

  it("un admin que es parte ve el aviso y no el formulario de resolución", () => {
    render(
      <>
        <ResolveNotice
          disputeId={ID}
          status={DisputeStatus.OPEN}
          resolution={null}
          names={NAMES}
          conflict
        />
        <ResolveAction
          disputeId={ID}
          status={DisputeStatus.OPEN}
          preview={preview}
          names={NAMES}
          conflict
        />
      </>
    )
    expect(screen.getByRole("note").textContent).toContain(
      "no podés resolver la disputa"
    )
    expect(
      screen.queryByRole("button", { name: "Resolver disputa" })
    ).toBeNull()
  })

  it("el razonamiento es obligatorio y hay que confirmar que mueve plata", async () => {
    actions.resolve.mockResolvedValue({
      ok: true,
      data: { replayed: false },
    })
    renderOpen()
    const dialog = openDialog()
    const next = () =>
      within(dialog).getByRole("button", { name: /Continuar|Resolver disputa/ })
    expect((next() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dialog).getByLabelText(/A favor del emisor/))
    fireEvent.click(next())
    expect(
      within(dialog).getByText("Se libera la reserva del emisor")
    ).toBeTruthy()
    fireEvent.click(next())

    const submit = within(dialog).getByRole("button", {
      name: "Resolver disputa",
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("Razonamiento"), {
      target: { value: "corto" },
    })
    fireEvent.click(within(dialog).getByRole("checkbox"))
    expect(submit.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("Razonamiento"), {
      target: { value: "El handshake no se completó nunca." },
    })
    expect(submit.disabled).toBe(false)
    await act(async () => fireEvent.click(submit))
    expect(actions.resolve).toHaveBeenCalledWith(open.detail.id, {
      outcome: "sender",
      reasoning: "El handshake no se completó nunca.",
    })
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Resultado: a favor del emisor"
      )
    )
  })

  it("parcial: un monto bajo el mínimo muestra el mínimo y no deja continuar", () => {
    renderOpen()
    const dialog = openDialog()
    fireEvent.click(within(dialog).getByLabelText(/Parcial/))
    fireEvent.click(within(dialog).getByRole("button", { name: "Otro monto" }))
    const amount = within(dialog).getByLabelText(/Monto que conserva/)
    fireEvent.change(amount, { target: { value: String(min - 1) } })
    expect(within(dialog).getByRole("alert").textContent).toMatch(
      /El mínimo es/
    )
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Continuar",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.change(amount, { target: { value: String(min) } })
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Continuar",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })

  it("parcial: un porcentaje que no cubre las comisiones está deshabilitado", () => {
    const tight = {
      data: {
        ...open.preview,
        minimumPartialArs: open.preview.stakeArs * 0.4,
        presets: open.preview.presets.map((p) => ({
          ...p,
          belowMinimum: p.percentage < 50,
        })),
      },
      error: null,
    }
    render(
      <ResolveAction
        disputeId={open.detail.id}
        status={DisputeStatus.OPEN}

        preview={tight}
        names={NAMES}
        conflict={false}
      />
    )
    const dialog = openDialog()
    fireEvent.click(within(dialog).getByLabelText(/Parcial/))
    expect(
      (
        within(dialog).getByRole("button", {
          name: "25 %",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (
        within(dialog).getByRole("button", {
          name: "50 %",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })

  it("si falla la vista previa muestra el error del bloque y no el botón", () => {
    render(
      <ResolveAction
        disputeId={ID}
        status={DisputeStatus.OPEN}
        preview={{
          data: null,
          error: { code: "SHIPMENTS_SERVICE_UNAVAILABLE", message: "x" },
        }}
        names={NAMES}
        conflict={false}
      />
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "No pudimos cargar la vista previa de la resolución."
    )
    expect(
      screen.queryByRole("button", { name: "Resolver disputa" })
    ).toBeNull()
  })

  it("una disputa con el pago fallido lo dice y reintenta con los mismos datos", async () => {
    const resolution: AdminDisputeResolution = {
      outcome: "partial",
      reasoning: "La caja ya venía dañada.",
      percentage: null,
      carrierAmountArs: 3000,
      senderAmountArs: 5000,
      paymentAction: "capture_partial",
      resolvedBy: "Tomás",
      resolvedAt: null,
    }
    actions.resolve.mockResolvedValue({ ok: true, data: {} })
    render(
      <ResolveNotice
        disputeId={ID}
        status={DisputeStatus.RESOLVING}
        resolution={resolution}
        names={NAMES}
        conflict={false}
      />
    )
    expect(screen.getByRole("alert").textContent).toContain("no se confirmó")
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: /Reintentar con los mismos datos/ })
      )
    )
    expect(actions.resolve).toHaveBeenCalledWith(ID, {
      outcome: "partial",
      reasoning: "La caja ya venía dañada.",
      amountArs: 3000,
    })
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "La acción de pago salió"
      )
    )
  })
})
