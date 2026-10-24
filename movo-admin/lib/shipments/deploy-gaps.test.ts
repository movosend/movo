import { describe, expect, it } from "vitest"
import { detail } from "./test-fixtures"
import { withDeployGaps } from "./deploy-gaps"

type OldResponse = Parameters<typeof withDeployGaps>[0]

const blocks: Omit<OldResponse, "shipment" | "offers"> = {
  events: { data: [], error: null },
  photos: { data: [], error: null },
  payment: { data: null, error: null },
  parties: { data: [], error: null },
}

describe("detalle con un backend anterior al panel", () => {
  it("sin el bloque de ofertas, solo ese bloque viene con error", () => {
    const response = withDeployGaps({ shipment: detail(), ...blocks })
    expect(response.offers).toEqual({
      data: null,
      error: expect.objectContaining({ code: "SHIPMENTS_SERVICE_UNAVAILABLE" }),
    })
    expect(response.events).toBe(blocks.events)
  })

  it("sin el retiro pedido, usa el actual", () => {
    const shipment: OldResponse["shipment"] = detail({
      pickupDate: "2026-10-25",
      pickupTimeWindowStart: "08:00",
    })
    delete shipment.requestedPickupDate
    delete shipment.requestedPickupTimeWindowStart
    delete shipment.requestedPickupTimeWindowEnd
    const response = withDeployGaps({
      shipment,
      ...blocks,
      offers: { data: [], error: null },
    })
    expect(response.shipment).toMatchObject({
      requestedPickupDate: "2026-10-25",
      requestedPickupTimeWindowStart: "08:00",
      requestedPickupTimeWindowEnd: "12:00",
    })
  })

  it("con todo presente, no cambia nada", () => {
    const shipment = detail({ requestedPickupDate: "2026-10-19" })
    const response = withDeployGaps({
      shipment,
      ...blocks,
      offers: { data: [], error: null },
    })
    expect(response.shipment.requestedPickupDate).toBe("2026-10-19")
    expect(response.offers).toEqual({ data: [], error: null })
  })
})
