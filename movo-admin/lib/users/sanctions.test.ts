import { describe, expect, it } from "vitest"
import type { AdminUserSanction } from "@movo/shared/src/types/admin-users"
import {
  describePreview,
  describeWithdrawn,
  needsWithdrawalRetry,
} from "./sanctions"

const shipment = (id: string) => ({
  id,
  shortId: id.toUpperCase(),
  status: "in_transit" as const,
  userRole: "sender" as const,
  pickupAddress: "Córdoba",
  deliveryAddress: "Rosario",
})

describe("describePreview", () => {
  it("arma el texto del ticket: lo que se retira y lo que sigue", () => {
    expect(
      describePreview({
        shipments: 2,
        offers: 1,
        trips: 0,
        recurringSeries: 0,
        inProgressShipments: [shipment("a"), shipment("b"), shipment("c")],
      })
    ).toEqual([
      "Se van a cancelar 2 publicaciones y retirar 1 oferta.",
      "Los 3 envíos en curso siguen; se avisa a las contrapartes que no puede tomar envíos nuevos.",
    ])
  })

  it("sin nada abierto lo dice, y nombra la serie recurrente y el único envío en curso", () => {
    expect(
      describePreview({
        shipments: 0,
        offers: 0,
        trips: 0,
        recurringSeries: 1,
        inProgressShipments: [shipment("a")],
      })
    ).toEqual([
      "No tiene publicaciones, ofertas ni viajes abiertos para retirar.",
      "Se corta 1 viaje recurrente: no se generan más repeticiones.",
      "El envío en curso sigue; se avisa a las contrapartes que no puede tomar envíos nuevos.",
    ])
  })
})

describe("describeWithdrawn", () => {
  it("resume lo retirado", () => {
    expect(
      describeWithdrawn({
        cancelledShipmentIds: ["a"],
        withdrawnOfferIds: ["b", "c"],
        cancelledTripIds: [],
        stoppedRecurrenceTripIds: ["d"],
        notifiedCounterpartyCount: 0,
        failures: [],
      })
    ).toBe(
      "1 publicación cancelada, 2 ofertas retiradas y 1 serie recurrente cortada."
    )
  })
})

describe("needsWithdrawalRetry", () => {
  const sanction = (over: Partial<AdminUserSanction>): AdminUserSanction => ({
    id: "s",
    userId: "u",
    type: "suspension",
    reason: "x",
    internalNote: null,
    startedAt: "2026-10-20T00:00:00.000Z",
    endsAt: null,
    appliedBy: null,
    appliedByName: null,
    liftedAt: null,
    liftedBy: null,
    liftedByName: null,
    liftReason: null,
    closedCause: null,
    withdrawal: null,
    ...over,
  })
  const withdrawal = (status: "complete" | "partial" | "failed") => ({
    status,
    result: null,
    errorCode: null,
    attemptedAt: "2026-10-20T00:00:00.000Z",
  })

  it("solo en una sanción vigente con el retiro parcial o fallido", () => {
    expect(
      needsWithdrawalRetry(sanction({ withdrawal: withdrawal("failed") }))
    ).toBe(true)
    expect(
      needsWithdrawalRetry(sanction({ withdrawal: withdrawal("partial") }))
    ).toBe(true)
    expect(
      needsWithdrawalRetry(sanction({ withdrawal: withdrawal("complete") }))
    ).toBe(false)
    expect(needsWithdrawalRetry(sanction({ withdrawal: null }))).toBe(false)
    expect(
      needsWithdrawalRetry(
        sanction({
          withdrawal: withdrawal("failed"),
          liftedAt: "2026-10-21T00:00:00.000Z",
        })
      )
    ).toBe(false)
    expect(needsWithdrawalRetry(null)).toBe(false)
  })
})
