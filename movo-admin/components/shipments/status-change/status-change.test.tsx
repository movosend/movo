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

const actions = vi.hoisted(() => ({
  loadStatusOptions: vi.fn(),
  sendStepUpCode: vi.fn(),
  submitStatusChange: vi.fn(),
}))
vi.mock("@/app/shipments/status-actions", () => actions)

import type {
  ShipmentStatusOption,
  ShipmentStatusOptions,
} from "@movo/shared/src/types/admin-shipments"
import {
  StatusChangeButton,
  StatusChangeNotice,
  StatusChangeProvider,
} from "./status-change"

const ID = "7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e548"
const CODE = "MOVO-34548"
const REASON =
  "El transportista no responde hace dos días y el emisor pidió destrabarlo"

const opt = (over: Partial<ShipmentStatusOption>): ShipmentStatusOption => ({
  targetStatus: "cancelled",
  kind: "manual",
  risk: "medium",
  effects: ["Cierra las ofertas pendientes del envío."],
  notifies: ["sender", "receiver"],
  checks: [],
  irreversible: [],
  requiresTypedCode: false,
  requiresStepUp: false,
  ...over,
})

const options = (
  over: Partial<ShipmentStatusOptions> = {}
): ShipmentStatusOptions => ({
  current: "published",
  code: CODE,
  options: [opt({})],
  blocked: [
    {
      targetStatus: "in_transit",
      reason: "El retiro se confirma con el handshake.",
    },
  ],
  ...over,
})

/** Los tres escenarios de fricción: medio manual, alto manual (código) y alto forzado (código + OTP). */
const MEDIUM = options()
const HIGH = options({
  current: "assignment_pending",
  options: [
    opt({
      targetStatus: "assigned",
      risk: "high",
      requiresTypedCode: true,
      notifies: ["sender", "receiver", "carrier"],
      checks: ["Confirmá en Mercado Pago que el hold está autorizado."],
      irreversible: ["Se cierran las ofertas pendientes."],
    }),
  ],
  blocked: [],
})
const FORCED = options({
  current: "assigned",
  options: [
    opt({
      targetStatus: "cancelled",
      kind: "forced",
      risk: "high",
      requiresTypedCode: true,
      requiresStepUp: true,
      notifies: ["sender", "receiver", "carrier"],
      effects: ["Libera el hold del pago.", "El envío queda cancelado."],
      irreversible: ["Un envío cancelado es terminal."],
    }),
  ],
  blocked: [
    { targetStatus: "in_transit", reason: "Sin handshake no se fuerza." },
  ],
})
const TERMINAL = options({
  current: "cancelled",
  options: [],
  blocked: [
    {
      targetStatus: "published",
      reason: "Un envío cancelado no se puede reabrir.",
    },
  ],
})

const DONE = {
  shipmentId: ID,
  fromStatus: "published",
  toStatus: "cancelled",
  kind: "manual",
  replayed: false,
}
const CHALLENGE = {
  challengeId: "ch-1",
  maskedEmail: "t***@gmail.com",
  cooldownSeconds: 60,
  expiresInSeconds: 300,
}

function renderModal({ conflict = false, status = "published" as const } = {}) {
  return render(
    <StatusChangeProvider
      shipmentId={ID}
      displayCode={CODE}
      currentStatus={status}
    >
      <StatusChangeButton conflict={conflict} />
      <StatusChangeNotice />
    </StatusChangeProvider>
  )
}

const openModal = async (loaded: ShipmentStatusOptions) => {
  actions.loadStatusOptions.mockResolvedValue({ ok: true, data: loaded })
  fireEvent.click(screen.getByRole("button", { name: "Cambiar estado" }))
  await screen.findByRole("dialog")
  await waitFor(() =>
    expect(screen.queryByText("Cargando las opciones…")).toBeNull()
  )
}
const next = () =>
  fireEvent.click(
    screen.getByRole("button", { name: /^(Continuar|Pasar a|Forzar a)/ })
  )
const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
const goToConfirm = async (loaded: ShipmentStatusOptions) => {
  await openModal(loaded)
  // Sin opciones del flujo no hay nada preseleccionado: se elige la primera disponible.
  const radios = screen.getAllByRole("radio")
  if (
    !radios.some(
      (r) => (r as HTMLInputElement).getAttribute("aria-checked") === "true"
    )
  )
    fireEvent.click(radios.find((r) => !(r as HTMLButtonElement).disabled)!)
  next()
  next()
  await screen.findByLabelText("Motivo")
}

beforeEach(() => {
  actions.loadStatusOptions.mockReset()
  actions.sendStepUpCode.mockReset()
  actions.submitStatusChange.mockReset()
})
afterEach(cleanup)

describe("entrada", () => {
  it("el botón abre el modal con el estado actual y los tres pasos", async () => {
    renderModal()
    await openModal(MEDIUM)
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Cambiar estado")).toBeInTheDocument()
    expect(within(dialog).getByText("Publicado")).toBeInTheDocument()
    expect(within(dialog).getByText("1. Nuevo estado")).toBeInTheDocument()
    expect(within(dialog).getByText("2. Impacto")).toBeInTheDocument()
    expect(within(dialog).getByText("3. Confirmación")).toBeInTheDocument()
    expect(within(dialog).getByText("Paso 1 de 3")).toBeInTheDocument()
  })

  it("si el admin es parte del envío, el botón está deshabilitado y la razón se ve", () => {
    renderModal({ conflict: true })
    const button = screen.getByRole("button", { name: "Cambiar estado" })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(/Sos parte de este envío/)
    fireEvent.click(button)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(actions.loadStatusOptions).not.toHaveBeenCalled()
  })
})

describe("paso 1 — nuevo estado", () => {
  it("lista el flujo preseleccionado con su riesgo y deja lo bloqueado en un bloque colapsado", async () => {
    renderModal()
    await openModal(
      options({
        options: [
          opt({}),
          opt({ targetStatus: "assigned", kind: "forced", risk: "high" }),
        ],
      })
    )
    expect(screen.getByRole("radio", { name: /Cancelado/ })).toBeChecked()
    expect(screen.getAllByText("Riesgo medio").length).toBeGreaterThan(0)
    const outside = screen.getByRole("button", { name: "Fuera del flujo" })
    expect(outside).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("radio", { name: /Asignado/ })).toBeNull()
    fireEvent.click(outside)
    expect(outside).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("radio", { name: /Asignado/ })).toBeInTheDocument()
    // Lo bloqueado no es una opción: se ve atenuado, con su motivo.
    expect(screen.queryByRole("radio", { name: /En camino/ })).toBeNull()
    expect(
      screen.getByText("El retiro se confirma con el handshake.")
    ).toBeInTheDocument()
    expect(screen.getByText("En camino")).toBeInTheDocument()
  })

  it("en un estado terminal explica por qué no hay pasos y muestra lo bloqueado con su motivo", async () => {
    renderModal({ status: "cancelled" as never })
    await openModal(TERMINAL)
    expect(screen.getByText(/es un estado terminal/)).toBeInTheDocument()
    expect(
      screen.getByText("Un envío cancelado no se puede reabrir.")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled()
  })

  it("agrupa los bloqueados con el mismo motivo en una sola nota", async () => {
    renderModal({ status: "cancelled" as never })
    const same = "No hay un servicio de dominio que ejecute esta transición."
    await openModal(
      options({
        current: "cancelled",
        options: [],
        blocked: [
          { targetStatus: "published", reason: same },
          { targetStatus: "assigned", reason: same },
          { targetStatus: "in_transit", reason: "Sin handshake no se fuerza." },
        ],
      })
    )
    expect(screen.getAllByText(same)).toHaveLength(1)
    const notes = screen.getAllByRole("note")
    expect(notes).toHaveLength(2)
    expect(within(notes[0]!).getByText("Publicado")).toBeInTheDocument()
    expect(within(notes[0]!).getByText("Asignado")).toBeInTheDocument()
  })

  it("si falla la carga de opciones muestra el error y deja reintentar", async () => {
    renderModal()
    actions.loadStatusOptions.mockResolvedValueOnce({
      ok: false,
      error: "El servicio no respondió.",
    })
    fireEvent.click(screen.getByRole("button", { name: "Cambiar estado" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El servicio no respondió."
    )
    actions.loadStatusOptions.mockResolvedValue({ ok: true, data: MEDIUM })
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
    expect(
      await screen.findByRole("radio", { name: /Cancelado/ })
    ).toBeInTheDocument()
  })
})

describe("paso 2 — impacto", () => {
  it("muestra origen → destino, riesgo, qué va a pasar, a quién se avisa, qué verificar y qué no se deshace", async () => {
    renderModal({ status: "assignment_pending" as never })
    await openModal(HIGH)
    next()
    expect(await screen.findByText("Riesgo alto.")).toBeInTheDocument()
    expect(screen.getByText("Qué va a pasar")).toBeInTheDocument()
    expect(
      screen.getByText("Emisor, receptor y transportista")
    ).toBeInTheDocument()
    expect(screen.getByText(/Antes de seguir:/)).toBeInTheDocument()
    expect(screen.getByText(/Qué no se deshace:/)).toBeInTheDocument()
    expect(screen.queryByText("Fuera del flujo")).toBeNull()
  })

  it("una forzada se marca fuera del flujo y avisa que queda registrada como forzada", async () => {
    renderModal({ status: "assigned" as never })
    await openModal(FORCED)
    fireEvent.click(screen.getByRole("radio", { name: /Cancelado/ }))
    next()
    expect(await screen.findByText("Fuera del flujo")).toBeInTheDocument()
    expect(screen.getByText(/Queda marcado como forzado/)).toBeInTheDocument()
  })

  it("Atrás vuelve al paso anterior", async () => {
    renderModal()
    await openModal(MEDIUM)
    next()
    fireEvent.click(await screen.findByRole("button", { name: "Atrás" }))
    expect(screen.getByText("Paso 1 de 3")).toBeInTheDocument()
  })
})

describe("paso 3 — requisitos por riesgo", () => {
  it("riesgo medio: solo motivo (mínimo 20, con contador) y el check", async () => {
    renderModal()
    await goToConfirm(MEDIUM)
    expect(screen.queryByLabelText(/Escribí/)).toBeNull()
    expect(screen.queryByLabelText("Código de 6 dígitos")).toBeNull()
    const confirm = screen.getByRole("button", { name: "Pasar a Cancelado" })
    expect(confirm).toBeDisabled()
    type("Motivo", "muy corto")
    expect(screen.getByText("9 / 20 mínimo")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox"))
    expect(confirm).toBeDisabled()
    type("Motivo", REASON)
    expect(screen.getByText(`${REASON.length} caracteres`)).toBeInTheDocument()
    expect(confirm).toBeEnabled()
    expect(screen.getByRole("checkbox").closest("label")).toHaveTextContent(
      `Entiendo lo que implica pasar #${CODE} a Cancelado y que la acción queda a mi nombre.`
    )
  })

  it("riesgo alto: pide el código del envío, acepta # y minúsculas y marca el borde según coincida", async () => {
    renderModal({ status: "assignment_pending" as never })
    await goToConfirm(HIGH)
    type("Motivo", REASON)
    fireEvent.click(screen.getByRole("checkbox"))
    const confirm = screen.getByRole("button", { name: "Pasar a Asignado" })
    expect(confirm).toBeDisabled()
    const typed = screen.getByLabelText(/Escribí/)
    expect(typed).not.toHaveAttribute("aria-invalid", "true")
    type(/Escribí/, "MOVO-99999")
    expect(typed).toHaveAttribute("aria-invalid", "true")
    expect(typed.className).toMatch(/border-danger-fg/)
    expect(confirm).toBeDisabled()
    type(/Escribí/, "#movo-34548")
    expect(typed).not.toHaveAttribute("aria-invalid", "true")
    expect(typed.className).toMatch(/border-success-fg/)
    expect(confirm).toBeEnabled()
    expect(confirm.className).not.toMatch(/danger-solid/)
  })

  it("forzada: pide además el código por email, 'Enviar código' llama al step-up y el botón final es rojo", async () => {
    renderModal({ status: "assigned" as never })
    await goToConfirm(FORCED)
    type("Motivo", REASON)
    type(/Escribí/, CODE)
    fireEvent.click(screen.getByRole("checkbox"))
    const confirm = screen.getByRole("button", { name: "Forzar a Cancelado" })
    expect(confirm.className).toMatch(/danger-solid/)
    expect(confirm).toBeDisabled()
    expect(screen.getByLabelText("Código de 6 dígitos")).toBeDisabled()

    actions.sendStepUpCode.mockResolvedValue({ ok: true, data: CHALLENGE })
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }))
    expect(await screen.findByText("t***@gmail.com")).toBeInTheDocument()
    expect(actions.sendStepUpCode).toHaveBeenCalledWith(ID, "cancelled")
    // El contador arranca en el primer tick (milisegundos después de recibir el desafío).
    expect(
      await screen.findByRole("button", { name: /Reenviar en \d+ s/ })
    ).toBeDisabled()
    type("Código de 6 dígitos", "123")
    expect(confirm).toBeDisabled()
    type("Código de 6 dígitos", "123456")
    expect(confirm).toBeEnabled()
  })

  it("un error al pedir el código se muestra sin perder lo escrito", async () => {
    renderModal({ status: "assigned" as never })
    await goToConfirm(FORCED)
    type("Motivo", REASON)
    actions.sendStepUpCode.mockResolvedValue({
      ok: false,
      error: "Demasiados intentos.",
      code: "RATE_LIMIT_EXCEEDED",
    })
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Demasiados intentos."
    )
    expect(screen.getByLabelText("Motivo")).toHaveValue(REASON)
  })
})

describe("confirmar", () => {
  const fillMedium = async () => {
    await goToConfirm(MEDIUM)
    type("Motivo", REASON)
    fireEvent.click(screen.getByRole("checkbox"))
  }

  it("éxito: manda estado esperado, destino y motivo, cierra el modal y muestra el aviso con a quién se avisó", async () => {
    renderModal()
    await fillMedium()
    actions.submitStatusChange.mockResolvedValue({ ok: true, data: DONE })
    fireEvent.click(screen.getByRole("button", { name: "Pasar a Cancelado" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(actions.submitStatusChange).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({
        targetStatus: "cancelled",
        expectedStatus: "published",
        reason: REASON,
        idempotencyKey: expect.any(String),
      })
    )
    const sent = actions.submitStatusChange.mock.calls[0][1]
    expect(sent).not.toHaveProperty("typedCode")
    expect(sent).not.toHaveProperty("otp")
    const notice = screen.getByRole("status")
    expect(notice).toHaveTextContent(`#${CODE} pasó a Cancelado.`)
    expect(notice).toHaveTextContent(
      "Quedó en la línea de tiempo y en la bitácora. Avisamos a: emisor y receptor."
    )
    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }))
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("forzada: manda el código del envío y el código por email", async () => {
    renderModal({ status: "assigned" as never })
    await goToConfirm(FORCED)
    type("Motivo", REASON)
    type(/Escribí/, CODE)
    fireEvent.click(screen.getByRole("checkbox"))
    actions.sendStepUpCode.mockResolvedValue({ ok: true, data: CHALLENGE })
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }))
    await screen.findByText("t***@gmail.com")
    type("Código de 6 dígitos", "123456")
    actions.submitStatusChange.mockResolvedValue({
      ok: true,
      data: { ...DONE, fromStatus: "assigned", kind: "forced" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Forzar a Cancelado" }))
    await waitFor(() => expect(actions.submitStatusChange).toHaveBeenCalled())
    expect(actions.submitStatusChange.mock.calls[0][1]).toMatchObject({
      typedCode: CODE,
      otp: { challengeId: "ch-1", code: "123456" },
    })
  })

  it("mientras se aplica: el botón dice 'Aplicando…', Atrás y Cancelar se deshabilitan y Escape no cierra", async () => {
    renderModal()
    await fillMedium()
    let resolve: (v: unknown) => void = () => undefined
    actions.submitStatusChange.mockReturnValue(
      new Promise((r) => (resolve = r))
    )
    fireEvent.click(screen.getByRole("button", { name: "Pasar a Cancelado" }))
    expect(
      await screen.findByRole("button", { name: /Aplicando/ })
    ).toBeDisabled()
    expect(screen.getByRole("button", { name: "Atrás" })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByLabelText("Motivo")).toBeDisabled()
    await act(async () => resolve({ ok: true, data: DONE }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("Escape cierra el modal cuando no se está aplicando", async () => {
    renderModal()
    await openModal(MEDIUM)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})

describe("errores (nunca se pierde lo escrito)", () => {
  const confirmMedium = async (failure: Record<string, unknown>) => {
    await goToConfirm(MEDIUM)
    type("Motivo", REASON)
    fireEvent.click(screen.getByRole("checkbox"))
    actions.submitStatusChange.mockResolvedValue({ ok: false, ...failure })
    fireEvent.click(screen.getByRole("button", { name: "Pasar a Cancelado" }))
  }

  it("STATUS_CHANGED: recarga las opciones, vuelve al paso 1 y conserva el motivo", async () => {
    renderModal()
    await confirmMedium({
      error: "El estado del envío cambió mientras confirmabas.",
      code: "STATUS_CHANGED",
      status: 409,
      currentStatus: "cancelled",
    })
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El estado del envío cambió"
    )
    await waitFor(() =>
      expect(actions.loadStatusOptions).toHaveBeenCalledTimes(2)
    )
    expect(screen.getByText("Paso 1 de 3")).toBeInTheDocument()
    next()
    next()
    expect(await screen.findByLabelText("Motivo")).toHaveValue(REASON)
  })

  it.each([
    ["TRANSITION_NOT_ALLOWED", "Esta transición no está permitida."],
    ["HOLD_NOT_AUTHORIZED", "Mercado Pago no tiene el hold autorizado."],
    ["ADMIN_CONFLICT_OF_INTEREST", "Sos parte de este envío."],
    ["TYPED_CODE_MISMATCH", "El código del envío no coincide."],
  ])("%s se explica", async (code, error) => {
    renderModal()
    await confirmMedium({ error, code, status: 422 })
    expect(await screen.findByRole("alert")).toHaveTextContent(error)
    if (code !== "TRANSITION_NOT_ALLOWED") {
      expect(screen.getByLabelText("Motivo")).toHaveValue(REASON)
    }
  })

  it("un servicio caído avisa que el cambio pudo aplicarse y no pierde lo escrito", async () => {
    renderModal()
    await confirmMedium({
      error: "El servicio no respondió. Puede que el cambio se haya aplicado.",
      code: "SHIPMENTS_SERVICE_UNAVAILABLE",
      status: 502,
      unconfirmed: true,
    })
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Puede que el cambio se haya aplicado"
    )
    expect(screen.getByLabelText("Motivo")).toHaveValue(REASON)
    expect(
      screen.getByRole("button", { name: "Pasar a Cancelado" })
    ).toBeEnabled()
  })

  it("código por email inválido: lo limpia, pide uno nuevo y conserva motivo y código del envío", async () => {
    renderModal({ status: "assigned" as never })
    await goToConfirm(FORCED)
    type("Motivo", REASON)
    type(/Escribí/, CODE)
    fireEvent.click(screen.getByRole("checkbox"))
    actions.sendStepUpCode.mockResolvedValue({ ok: true, data: CHALLENGE })
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }))
    await screen.findByText("t***@gmail.com")
    type("Código de 6 dígitos", "123456")
    actions.submitStatusChange.mockResolvedValue({
      ok: false,
      error: "El código es inválido, venció o ya se usó.",
      code: "STEP_UP_INVALID",
      status: 401,
    })
    fireEvent.click(screen.getByRole("button", { name: "Forzar a Cancelado" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El código es inválido"
    )
    expect(screen.getByLabelText("Motivo")).toHaveValue(REASON)
    expect(screen.getByLabelText(/Escribí/)).toHaveValue(CODE)
    expect(
      screen.getByRole("button", { name: "Enviar código" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Forzar a Cancelado" })
    ).toBeDisabled()
  })

  it("un rechazo de negocio que no gastó el token lo conserva: el reintento no pide otro código", async () => {
    renderModal({ status: "assigned" as never })
    await goToConfirm(FORCED)
    type("Motivo", REASON)
    type(/Escribí/, CODE)
    fireEvent.click(screen.getByRole("checkbox"))
    actions.sendStepUpCode.mockResolvedValue({ ok: true, data: CHALLENGE })
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }))
    await screen.findByText("t***@gmail.com")
    type("Código de 6 dígitos", "123456")
    actions.submitStatusChange.mockResolvedValueOnce({
      ok: false,
      error: "Mercado Pago no tiene el hold autorizado.",
      code: "HOLD_NOT_AUTHORIZED",
      status: 422,
      stepUpToken: "tok-verified",
    })
    fireEvent.click(screen.getByRole("button", { name: "Forzar a Cancelado" }))
    await screen.findByRole("alert")
    expect(screen.getByText("Código verificado.")).toBeInTheDocument()
    actions.submitStatusChange.mockResolvedValueOnce({ ok: true, data: DONE })
    fireEvent.click(screen.getByRole("button", { name: "Forzar a Cancelado" }))
    await waitFor(() =>
      expect(actions.submitStatusChange).toHaveBeenCalledTimes(2)
    )
    const retry = actions.submitStatusChange.mock.calls[1][1]
    expect(retry).toMatchObject({ stepUpToken: "tok-verified" })
    expect(retry).not.toHaveProperty("otp")
    expect(retry.idempotencyKey).toBe(
      actions.submitStatusChange.mock.calls[0][1].idempotencyKey
    )
  })
})
