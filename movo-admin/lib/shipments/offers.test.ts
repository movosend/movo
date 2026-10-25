import { describe, expect, it } from "vitest"
import { detail, offer } from "./test-fixtures"
import {
  commissionLabel,
  deltaLabel,
  deltaShort,
  formatDuration,
  offerLife,
  offerPickup,
  parseAcceptance,
  priceRank,
  rankLabel,
  receivedLabel,
  requestedPickup,
  sortOffers,
  suggestedDelta,
  summarizeOffers,
} from "./offers"

const ID = "af26aeae-0695-409d-a5df-d5d9665f59b9"

describe("ofertas del envío", () => {
  it("diferencia contra el sugerido en % entero, con el copy de mobile", () => {
    expect(suggestedDelta(17200, 18500)).toBe(-7)
    expect(suggestedDelta(18500, 18500)).toBe(0)
    expect(suggestedDelta(18500, null)).toBeNull()
    expect(deltaLabel(-7)).toBe("-7% vs. sugerido")
    expect(deltaLabel(14)).toBe("+14% vs. sugerido")
    expect(deltaLabel(0)).toBe("= sugerido")
    expect(deltaShort(-7)).toBe("-7%")
    expect(deltaShort(0)).toBe("=")
  })

  it("posición por precio: los empates comparten puesto", () => {
    const offers = [
      offer({ id: "a", priceArs: 16900 }),
      offer({ id: "b", priceArs: 17200 }),
      offer({ id: "c", priceArs: 17200 }),
      offer({ id: "d", priceArs: 21000 }),
    ]
    expect(offers.map((o) => priceRank(o, offers))).toEqual([1, 2, 2, 4])
    expect(rankLabel(offers[0]!, offers)).toBe("la más barata de 4")
    expect(rankLabel(offers[3]!, offers)).toBe(
      "de 4 · $4.100 más que la más barata"
    )
    expect(rankLabel(offers[0]!, [offers[0]!])).toBe("única oferta")
  })

  it("resumen: rango, mediana, retiradas y tiempo hasta elegir desde la primera oferta", () => {
    const summary = summarizeOffers([
      offer({
        id: "a",
        priceArs: 17200,
        createdAt: "2026-10-20T19:00:00.000Z",
      }),
      offer({
        id: "b",
        priceArs: 16900,
        status: "superseded",
        createdAt: "2026-10-20T18:30:00.000Z",
      }),
      offer({ id: "c", priceArs: 21000, status: "withdrawn" }),
      offer({ id: "d", priceArs: 18500, status: "expired" }),
    ])
    expect(summary).toMatchObject({
      count: 4,
      dropped: 2,
      pending: 0,
      minArs: 16900,
      maxArs: 21000,
      medianArs: 17850,
    })
    expect(summary?.accepted?.id).toBe("a")
    // 18:30 → 21:12
    expect(formatDuration(summary!.timeToChooseMs!)).toBe("2 h 42 min")
    expect(summarizeOffers([])).toBeNull()
  })

  it("retiro propuesto contra lo que pidió el emisor", () => {
    const shipment = detail()
    expect(offerPickup(offer(), shipment)).toEqual({
      when: expect.stringContaining("09:00–12:00"),
      note: "Lo que pidió el emisor",
    })
    expect(
      offerPickup(
        offer({ pickupTimeWindowStart: "10:00", pickupTimeWindowEnd: "11:00" }),
        shipment
      ).note
    ).toBe("Dentro de lo pedido")
    expect(
      offerPickup(
        offer({ pickupTimeWindowStart: "15:00", pickupTimeWindowEnd: "18:00" }),
        shipment
      ).note
    ).toBe("Otro horario, mismo día")
    expect(
      offerPickup(offer({ offeredDate: "2026-10-22" }), shipment).note
    ).toBe("Propone otro día")
  })

  it("tras aceptar, compara contra lo pedido y no contra el retiro acordado que quedó en el envío", () => {
    // `acceptOffer` pisó `pickupDate` y la franja con los de la ganadora (MOVO-258 D3).
    const shipment = detail({
      pickupDate: "2026-10-22",
      pickupTimeWindowStart: "14:00",
      pickupTimeWindowEnd: "18:00",
    })
    const winner = offer({
      offeredDate: "2026-10-22",
      pickupTimeWindowStart: "14:00",
      pickupTimeWindowEnd: "18:00",
    })
    expect(offerPickup(winner, shipment).note).toBe("Propone otro día")
    // Una que no propuso franja toma la pedida (09:00–12:00), no la de la ganadora.
    expect(offerPickup(offer(), shipment)).toEqual({
      when: expect.stringContaining("09:00–12:00"),
      note: "Lo que pidió el emisor",
    })
    expect(requestedPickup(shipment)).toContain("09:00–12:00")
  })

  it("la comisión sale de la tasa del backend, no de los montos", () => {
    expect(commissionLabel(offer())).toBe("Comisión Movo (15%)")
    expect(
      commissionLabel(offer({ netArs: 0, commissionArs: 0 }))
    ).toBe("Comisión Movo (15%)")
  })

  it("el total de 'Cómo se reparte' en tercera persona, en lima solo si sigue en juego", () => {
    expect(receivedLabel(offer({ status: "pending" }), "published")).toEqual({
      label: "Recibe aprox.",
      highlight: true,
    })
    expect(receivedLabel(offer(), "in_transit")).toEqual({
      label: "Va a recibir aprox.",
      highlight: true,
    })
    expect(receivedLabel(offer(), "completed").label).toBe("Recibió aprox.")
    expect(receivedLabel(offer({ status: "rejected" }), "assigned")).toEqual({
      label: "Habría recibido aprox.",
      highlight: false,
    })
  })

  it("recorrido: una vencida sin `respondedAt` usa `expiresAt`, y 'Nunca' si el emisor no la vio", () => {
    const life = offerLife(
      offer({
        status: "expired",
        viewedAtBySender: null,
        respondedAt: null,
        expiresAt: "2026-10-20T22:00:00.000Z",
      })
    )
    expect(life.map((step) => step.label)).toEqual([
      "Ofertó",
      "Vista por el emisor",
      "Venció",
    ])
    expect(life[1]!.value).toBe("Nunca")
  })

  it("ordena por precio, reputación (sin calificar al final) o llegada", () => {
    const offers = [
      offer({
        id: "a",
        priceArs: 3,
        carrierRatingAtOffer: null,
        createdAt: "2026-10-20T10:00:00.000Z",
      }),
      offer({
        id: "b",
        priceArs: 1,
        carrierRatingAtOffer: 4.1,
        createdAt: "2026-10-20T12:00:00.000Z",
      }),
      offer({
        id: "c",
        priceArs: 2,
        carrierRatingAtOffer: 4.9,
        createdAt: "2026-10-20T11:00:00.000Z",
      }),
    ]
    const ids = (sort: Parameters<typeof sortOffers>[1]) =>
      sortOffers(offers, sort).map((o) => o.id)
    expect(ids("price")).toEqual(["b", "c", "a"])
    expect(ids("rating")).toEqual(["c", "b", "a"])
    expect(ids("time")).toEqual(["a", "c", "b"])
  })

  it("interpreta el motivo del evento de aceptación de svc-shipments", () => {
    expect(
      parseAcceptance(
        `Oferta ${ID} aceptada · ruta cercana: retiro en 1.7 días (dentro de 3); el emisor paga al aceptar`
      )
    ).toEqual({
      offerId: ID,
      tags: ["Ruta cercana", "Retiro en 1,7 días (N = 3)", "Paga al aceptar"],
    })
    expect(
      parseAcceptance(
        `Oferta ${ID} aceptada · ruta lejana: retiro en 4.2 días (a más de 3); el pago se confirma al abrirse la ventana`
      )?.tags
    ).toEqual([
      "Ruta lejana",
      "Retiro en 4,2 días (N = 3)",
      "Paga al abrirse la ventana",
    ])
    expect(
      parseAcceptance(`Oferta ${ID} aceptada · ruta cercana (N sin configurar)`)
        ?.tags
    ).toEqual(["Ruta cercana", "Paga al aceptar"])
    // Días enteros o negativos (`daysToPickup` de offer-repository).
    expect(
      parseAcceptance(
        `Oferta ${ID} aceptada · ruta lejana: retiro en 5 días (a más de 3); el pago se confirma al abrirse la ventana`
      )?.tags[1]
    ).toBe("Retiro en 5 días (N = 3)")
    expect(
      parseAcceptance(
        `Oferta ${ID} aceptada · ruta cercana: retiro en -0.3 días (dentro de 3); el emisor paga al aceptar`
      )?.tags
    ).toEqual(["Ruta cercana", "Retiro ya empezado al aceptar", "Paga al aceptar"])
    expect(parseAcceptance("Cancelado por el emisor")).toBeNull()
    expect(parseAcceptance(null)).toBeNull()
  })
})
