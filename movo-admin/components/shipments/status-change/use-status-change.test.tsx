import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"

const actions = vi.hoisted(() => ({
  loadStatusOptions: vi.fn(),
  sendStepUpCode: vi.fn(),
  submitStatusChange: vi.fn(),
}))
vi.mock("@/app/shipments/status-actions", () => actions)

import type { ShipmentStatusOptions } from "@movo/shared/src/types/admin-shipments"
import { useStatusChange } from "./use-status-change"

const ID = "7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e548"
const opts = (target: "cancelled" | "assigned"): ShipmentStatusOptions => ({
  current: "published",
  code: "MOVO-34548",
  options: [
    {
      targetStatus: target,
      kind: "manual",
      risk: "medium",
      effects: ["x"],
      notifies: ["sender"],
      checks: [],
      irreversible: [],
      requiresTypedCode: false,
      requiresStepUp: false,
    },
  ],
  blocked: [],
})

/** Una promesa que se resuelve a mano, para ordenar las respuestas. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  actions.loadStatusOptions.mockReset()
})
afterEach(cleanup)

describe("pedidos de opciones superpuestos", () => {
  it("una respuesta vieja no pisa a una nueva", async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    actions.loadStatusOptions
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { result } = renderHook(() =>
      useStatusChange({ shipmentId: ID, onDone: vi.fn() })
    )

    // La carga inicial sigue en vuelo cuando se pide otra (p. ej. tras un STATUS_CHANGED).
    act(() => result.current.reload())
    await act(async () => second.resolve({ ok: true, data: opts("assigned") }))
    await waitFor(() =>
      expect(result.current.state.options?.options[0]?.targetStatus).toBe(
        "assigned"
      )
    )

    // Llega tarde la respuesta de la primera: no vale.
    await act(async () => first.resolve({ ok: true, data: opts("cancelled") }))
    expect(result.current.state.options?.options[0]?.targetStatus).toBe(
      "assigned"
    )
    expect(result.current.state.target).toBe("assigned")
    expect(result.current.state.loading).toBe(false)
  })

  it("si la carga rechaza con algo que no es un error de la API, sale de 'cargando' y deja reintentar", async () => {
    actions.loadStatusOptions.mockRejectedValueOnce(
      new Error("se cortó el request")
    )
    const { result } = renderHook(() =>
      useStatusChange({ shipmentId: ID, onDone: vi.fn() })
    )
    await waitFor(() => expect(result.current.state.loading).toBe(false))
    expect(result.current.state.loadError).toMatch(
      /No pudimos completar la operación/
    )

    actions.loadStatusOptions.mockResolvedValueOnce({
      ok: true,
      data: opts("cancelled"),
    })
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.state.options).not.toBeNull())
    expect(result.current.state.loadError).toBeNull()
  })

  it("al desmontarse ignora lo que quede en vuelo", async () => {
    const pending = deferred<unknown>()
    actions.loadStatusOptions.mockReturnValueOnce(pending.promise)
    const { result, unmount } = renderHook(() =>
      useStatusChange({ shipmentId: ID, onDone: vi.fn() })
    )
    unmount()
    await act(async () =>
      pending.resolve({ ok: true, data: opts("cancelled") })
    )
    expect(result.current.state.options).toBeNull()
  })
})
