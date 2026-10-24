import { describe, expect, it } from "vitest"
import { isAdminShipmentAlert } from "@movo/shared/src/types/admin-shipments"
import {
  actorLabel,
  buildChatItems,
  buildTimeline,
  chatTitle,
  handshakes,
  partiesLine,
  paymentLabel,
  pendingSteps,
  pickupWindow,
  reportLine,
  rowAlert,
  shortName,
  timeAgo,
} from "./format"
import {
  CARRIER,
  event,
  message,
  NOW,
  RECEIVER,
  row,
  SENDER,
} from "./test-fixtures"

describe("textos de la fila", () => {
  it("partes cortas, con el transportista si hay", () => {
    expect(shortName("Ana María Molina")).toBe("Ana M.")
    expect(partiesLine(row())).toBe("Ana M. → Luis H. · vía Diego F.")
    expect(partiesLine(row({ carrier: null }))).toBe("Ana M. → Luis H.")
    expect(shortName(null)).toBe("Sin nombre")
  })

  it("ventana de retiro relativa a hoy en Argentina", () => {
    expect(pickupWindow(row(), NOW)).toBe("Hoy · 09:00 a 12:00 hs")
    expect(pickupWindow(row({ pickupDate: "2026-10-22" }), NOW)).toBe(
      "Mañana · 09:00 a 12:00 hs"
    )
    expect(pickupWindow(row({ pickupDate: "2026-10-25" }), NOW)).toBe(
      "25 oct · 09:00 a 12:00 hs"
    )
  })

  it("hace cuánto cambió", () => {
    expect(timeAgo("2026-10-21T14:54:00.000Z", NOW)).toBe("hace 6 min")
    expect(timeAgo("2026-10-21T12:00:00.000Z", NOW)).toBe("hace 3 h")
    expect(timeAgo("2026-10-20T15:00:00.000Z", NOW)).toBe("ayer 12:00")
  })
})

describe("avisos", () => {
  it("coinciden con la regla compartida del filtro `alert`", () => {
    const cases = [
      row(),
      row({ delayed: true }),
      row({
        status: "assigned_unfunded",
        fundingDeadline: "2026-10-21T20:00:00.000Z",
      }),
      row({
        status: "rejected_by_receiver",
        redesignationDeadline: "2026-10-22T15:00:00.000Z",
      }),
      row({ status: "disputed" }),
      row({ status: "published", carrier: null }),
    ]
    for (const r of cases)
      expect(rowAlert(r, NOW) !== null).toBe(isAdminShipmentAlert(r))
  })

  it("dice cuánto falta para el plazo", () => {
    expect(
      rowAlert(
        row({
          status: "assigned_unfunded",
          fundingDeadline: "2026-10-21T20:00:00.000Z",
        }),
        NOW
      )
    ).toBe("La ventana de pago vence en 5 h")
    expect(
      rowAlert(
        row({
          status: "assigned_unfunded",
          fundingDeadline: "2026-10-21T14:00:00.000Z",
        }),
        NOW
      )
    ).toBe("La ventana de pago ya venció")
    expect(rowAlert(row({ delayed: true }), NOW)).toMatch(/^Demorado/)
  })
})

describe("línea de tiempo", () => {
  it("pasos que faltan según el estado", () => {
    expect(pendingSteps("in_transit")).toEqual(["delivered", "completed"])
    expect(pendingSteps("assigned_unfunded")).toEqual([
      "assigned",
      "in_transit",
      "delivered",
      "completed",
    ])
    expect(pendingSteps("cancelled")).toEqual([])
    expect(pendingSteps("completed")).toEqual([])
  })

  it("ordena los eventos, marca el actual y agrega lo que falta", () => {
    const items = buildTimeline(
      [
        event("in_transit", "2026-10-21T12:24:00.000Z", {
          actorId: CARRIER.id,
        }),
        event("awaiting_receiver_confirmation", "2026-10-20T18:42:00.000Z", {
          actorId: SENDER.id,
        }),
      ],
      row()
    )
    expect(items.map((i) => [i.status, i.pending, i.current])).toEqual([
      ["awaiting_receiver_confirmation", false, false],
      ["in_transit", false, true],
      ["delivered", true, false],
      ["completed", true, false],
    ])
    expect(items[1]!.meta).toBe("21 oct · 09:24 · Diego Funes · Transportista")
    expect(items[2]!.title).toBe("Entrega a Luis")
  })

  it("el actor: una parte, el sistema u otra cuenta", () => {
    expect(actorLabel(null, row())).toBe("Sistema")
    expect(actorLabel(RECEIVER.id, row())).toBe("Luis Herrera · Receptor")
    expect(actorLabel("99999999-0000-4000-8000-000000000000", row())).toBe(
      "Cuenta 99999999"
    )
  })

  it("handshake con la hora del evento, o pendiente", () => {
    const hs = handshakes(row(), [
      event("in_transit", "2026-10-21T12:24:00.000Z"),
    ])
    expect(hs.pickup).toEqual({
      done: true,
      text: "Retiro confirmado con QR · 09:24",
    })
    expect(hs.delivery).toEqual({ done: false, text: "Entrega pendiente" })
    // Sin eventos (el bloque falló) se deduce del estado, sin hora.
    expect(handshakes(row({ status: "delivered" }), null).delivery.text).toBe(
      "Entrega confirmada con QR"
    )
  })

  it("pago: sin hold dice el paso del flujo", () => {
    expect(paymentLabel(null, "published").label).toBe("Sin pago todavía")
    expect(paymentLabel(null, "assigned_unfunded").label).toBe(
      "Ventana de pago abierta"
    )
  })
})

describe("chat", () => {
  it("título con los nombres de las partes", () => {
    expect(chatTitle(row())).toBe("Ana, Diego y Luis")
  })

  it("nota del reporte con el nombre de quien reportó", () => {
    expect(
      reportLine(
        {
          reporterId: RECEIVER.id,
          reporterRole: "receiver",
          createdAt: "2026-10-21T15:16:00.000Z",
        },
        row()
      )
    ).toBe("Luis reportó esta conversación · 21 oct · 12:16")
  })

  it("ordena del más viejo al más nuevo, separa por día e intercala eventos", () => {
    const items = buildChatItems(
      // La API los manda del más reciente al más antiguo.
      [
        message("Ya lo tengo", "2026-10-21T12:25:00.000Z", CARRIER),
        message("¡Gracias!", "2026-10-21T00:21:00.000Z"),
        message("Hola", "2026-10-21T00:14:00.000Z"),
      ],
      [event("in_transit", "2026-10-21T12:24:00.000Z")],
      true,
      NOW
    )
    expect(
      items.map((i) =>
        i.kind === "message" ? i.message.body : `${i.kind}:${i.label}`
      )
    ).toEqual([
      "day:Ayer",
      "Hola",
      "¡Gracias!",
      "day:Hoy",
      "event:Retiro confirmado",
      "Ya lo tengo",
    ])
    // Dos mensajes seguidos del mismo autor: solo el primero lleva nombre.
    const msgs = items.filter((i) => i.kind === "message")
    expect(msgs.map((m) => m.kind === "message" && m.head)).toEqual([
      true,
      false,
      true,
    ])
  })

  it("con páginas por cargar no muestra eventos anteriores al mensaje más viejo", () => {
    const items = buildChatItems(
      [message("Ya lo tengo", "2026-10-21T12:25:00.000Z", CARRIER)],
      [
        event("assigned", "2026-10-20T21:11:00.000Z"),
        event("in_transit", "2026-10-21T12:24:00.000Z"),
      ],
      false,
      NOW
    )
    expect(items.filter((i) => i.kind === "event")).toHaveLength(0)
  })
})
