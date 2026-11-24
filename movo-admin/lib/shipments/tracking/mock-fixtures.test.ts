import { beforeAll, describe, expect, it, vi } from "vitest"
import { MOCK_SHIPMENTS } from "@/lib/shipments/fixtures"
import { mockTracking } from "./mock"

vi.mock("server-only", () => ({}))

/** En una demo el mapa del envío (listado y disputas) no puede quedar en error: todo envío de las fixtures tiene seguimiento. */
describe("seguimiento mock de los envíos de las fixtures", () => {
  beforeAll(() => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
  })

  it("cada envío de las fixtures resuelve su seguimiento con su propio id", async () => {
    expect(MOCK_SHIPMENTS.length).toBeGreaterThan(0)
    for (const s of MOCK_SHIPMENTS) {
      const tracking = await mockTracking(s.detail.id)
      expect(tracking.shipmentId).toBe(s.detail.id)
    }
  })

  it("un id que no es de las fixtures sigue siendo 404", async () => {
    await expect(
      mockTracking("ffffffff-ffff-4fff-8fff-ffffffffffff")
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
