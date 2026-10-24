import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@movo/shared/src/errors/api-error"

const m = vi.hoisted(() => ({
  adminForApi: vi.fn(),
  getShipmentTracking: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/support/session-api", () => ({
  adminForApi: m.adminForApi,
  noStore: { "Cache-Control": "no-store" },
}))
vi.mock("@/lib/shipments/tracking/api", () => ({
  getShipmentTracking: m.getShipmentTracking,
}))

import { GET } from "./route"

const ID = "00000000-0000-4000-8000-000000000001"
const call = (id: string) =>
  GET(new NextRequest(`https://admin.test/api/shipments/${id}/tracking`), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  m.adminForApi.mockResolvedValue({ admin: {}, actor: {} })
})

describe("GET /api/shipments/[id]/tracking", () => {
  it("devuelve el seguimiento sin cache", async () => {
    m.getShipmentTracking.mockResolvedValue({ shipmentId: ID })
    const response = await call(ID)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ shipmentId: ID })
    expect(m.getShipmentTracking).toHaveBeenCalledWith(ID)
  })

  it("400 si el id no es un UUID, sin llamar al backend", async () => {
    const response = await call("../etc")
    expect(response.status).toBe(400)
    expect(m.getShipmentTracking).not.toHaveBeenCalled()
  })

  it("devuelve la respuesta de sesión tal cual (401/403)", async () => {
    m.adminForApi.mockResolvedValue(
      NextResponse.json({ error: "session" }, { status: 401 })
    )
    expect((await call(ID)).status).toBe(401)
    expect(m.getShipmentTracking).not.toHaveBeenCalled()
  })

  it("propaga el status y código del backend", async () => {
    m.getShipmentTracking.mockRejectedValue(
      new ApiError(404, "NOT_FOUND", "Envío no encontrado.")
    )
    const response = await call(ID)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "NOT_FOUND" })
  })

  it("503 ante un error inesperado", async () => {
    m.getShipmentTracking.mockRejectedValue(new Error("boom"))
    expect((await call(ID)).status).toBe(503)
  })
})
