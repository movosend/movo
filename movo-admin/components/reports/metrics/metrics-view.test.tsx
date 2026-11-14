import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const nav = { push: vi.fn(), refresh: vi.fn() }
vi.mock("next/navigation", () => ({ useRouter: () => nav }))
vi.mock("server-only", () => ({}))

import { EMPTY_METRICS_STATE, type MetricsState } from "@/lib/reports/params"
import { demoReport } from "@/lib/reports/mock"
import { ToastProvider } from "../toasts"
import { MetricsView } from "./metrics-view"

const query = { from: "2026-10-03", to: "2026-11-01" }

const fetchMock = vi.fn<typeof fetch>(
  async () =>
    new Response("a,b\r\n", { headers: { "x-export-rows": "0" } })
)

function view(
  id: "operations" | "finance",
  state: MetricsState,
  city?: string
) {
  const report = demoReport(id, { ...query, ...(city ? { city } : {}) })
  return render(
    <ToastProvider>
      <MetricsView id={id} report={report} highlight={null} state={state} />
    </ToastProvider>
  )
}

/** MOVO-35: las pestañas Operación y Finanzas, con los datos de demostración. */
describe("Métricas: Operación y Finanzas", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    URL.createObjectURL = vi.fn(() => "blob:x")
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    cleanup()
    nav.push.mockClear()
    fetchMock.mockClear()
    vi.unstubAllGlobals()
  })

  it("Operación elige la ciudad del retiro y la lleva a la URL y al CSV", async () => {
    const state = {
      ...EMPTY_METRICS_STATE,
      tab: "operations" as const,
      city: "Córdoba",
    }
    view("operations", state, "Córdoba")

    expect(screen.getByText("Por qué se cancelan")).toBeTruthy()
    expect(screen.getByText("Publicados por ciudad de retiro")).toBeTruthy()
    const select = screen.getByRole<HTMLSelectElement>("combobox")
    expect(select.value).toBe("Córdoba")

    await userEvent.click(screen.getAllByRole("button", { name: "CSV" })[0])
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "city=C%C3%B3rdoba"
    )

    await userEvent.selectOptions(select, "")
    expect(nav.push).toHaveBeenCalledWith("/metrics?tab=operations", {
      scroll: false,
    })
  })

  it("Finanzas muestra aparte lo que Mercado Pago no confirmó y ofrece el CSV de liquidaciones", async () => {
    view("finance", { ...EMPTY_METRICS_STATE, tab: "finance" })

    expect(screen.getByText(/esperan que Mercado Pago confirme/)).toBeTruthy()
    expect(screen.getByText(/a proceso manual/)).toBeTruthy()
    expect(screen.getByText("Cuenta corriente al cierre del rango")).toBeTruthy()
    // Finanzas no se filtra por distancia: ningún subtítulo lo menciona.
    expect(screen.queryByText(/todas las distancias/)).toBeNull()

    await userEvent.click(
      screen.getByRole("button", { name: "CSV de liquidaciones" })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/reports/finance/export?"
    )
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "section=settlements"
    )
  })
})
