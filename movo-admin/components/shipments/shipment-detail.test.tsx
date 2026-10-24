import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => nav }))
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/app/shipments/actions", () => ({ loadChatPage: vi.fn() }))

import type { AdminShipmentPartyCard } from "@movo/shared/src/types/admin-shipments"
import { buildChatItems } from "@/lib/shipments/format"
import {
  CARRIER,
  detail,
  event,
  message,
  NOW,
  RECEIVER,
  SENDER,
} from "@/lib/shipments/test-fixtures"
import { ChatThread } from "./chat-panel"
import {
  AlertBanner,
  LegsCard,
  PackagePaymentCard,
  PartiesCard,
  Timeline,
} from "./detail"

afterEach(cleanup)

const failed = {
  data: null,
  error: { code: "USERS_SERVICE_UNAVAILABLE", message: "x" },
}
const card = (
  p: typeof SENDER,
  role: AdminShipmentPartyCard["role"]
): AdminShipmentPartyCard => ({
  id: p.id,
  role,
  fullName: p.name,
  photoUrl: null,
  accountStatus: "active",
  identityVerified: true,
  licenseVerified: role === "carrier",
  reputationScore: 4.8,
  ratingCount: 12,
})

describe("detalle del envío", () => {
  it("un bloque con error muestra su reintento y el resto se ve", () => {
    render(
      <>
        <PartiesCard shipment={detail()} parties={failed} />
        <PackagePaymentCard shipment={detail()} payment={failed} />
      </>
    )
    const alerts = screen.getAllByRole("alert")
    expect(alerts).toHaveLength(2)
    expect(
      within(alerts[0]!).getByText("No pudimos cargar las partes.")
    ).toBeTruthy()
    expect(
      within(alerts[1]!).getByText("No pudimos cargar el pago.")
    ).toBeTruthy()
    // Los datos del paquete vienen del envío: siguen a la vista.
    expect(screen.getByText("Paquete estándar")).toBeTruthy()
    expect(screen.getByText("3 kg")).toBeTruthy()
    fireEvent.click(
      within(alerts[0]!).getByRole("button", { name: /Reintentar/ })
    )
    expect(nav.refresh).toHaveBeenCalled()
  })

  it("partes con reputación, verificación y link a la ficha; sin transportista, 'Sin asignar'", () => {
    render(
      <PartiesCard
        shipment={detail({ carrier: null })}
        parties={{
          data: [card(SENDER, "sender"), card(RECEIVER, "receiver")],
          error: null,
        }}
      />
    )
    const ana = screen.getByRole("link", { name: /Ana Molina/ })
    expect(ana.getAttribute("href")).toBe(`/users/${SENDER.id}`)
    expect(ana.textContent).toContain(
      "4,8 · 12 calificaciones · identidad verificada"
    )
    expect(screen.getByText("Sin asignar")).toBeTruthy()
    expect(screen.getByText("Esperando ofertas")).toBeTruthy()
  })

  it("tramos con el estado del handshake", () => {
    render(
      <LegsCard
        shipment={detail()}
        events={[event("in_transit", "2026-10-21T12:24:00.000Z")]}
        now={NOW}
      />
    )
    expect(screen.getByText("Retiro confirmado con QR · 09:24")).toBeTruthy()
    expect(screen.getByText("Entrega pendiente")).toBeTruthy()
  })

  it("línea de tiempo con eventos reales y los pasos que faltan", () => {
    render(
      <Timeline
        shipment={detail()}
        events={{
          data: [
            event(
              "awaiting_receiver_confirmation",
              "2026-10-20T18:42:00.000Z",
              { actorId: SENDER.id }
            ),
            event("in_transit", "2026-10-21T12:24:00.000Z", {
              actorId: CARRIER.id,
            }),
          ],
          error: null,
        }}
      />
    )
    expect(screen.getByText("2 eventos · 2 por venir")).toBeTruthy()
    const items = screen.getAllByRole("listitem")
    expect(items.filter((li) => li.dataset.pending)).toHaveLength(2)
    expect(within(items[1]!).getByText("Actual")).toBeTruthy()
    expect(within(items[2]!).getByText("Entrega a Luis")).toBeTruthy()
    expect(within(items[2]!).getByText("(pendiente)")).toBeTruthy()
  })

  it("línea de tiempo caída: error con reintento", () => {
    render(<Timeline shipment={detail()} events={failed} />)
    expect(
      screen.getByText("No pudimos cargar la línea de tiempo.")
    ).toBeTruthy()
  })

  it("aviso destacado con qué mirar", () => {
    render(
      <>
        <AlertBanner
          shipment={detail({
            status: "assigned_unfunded",
            fundingDeadline: "2026-10-21T20:00:00.000Z",
          })}
          now={NOW}
        />
      </>
    )
    expect(screen.getByText("La ventana de pago vence en 5 h")).toBeTruthy()
    expect(
      screen.getByText(/el barrido devuelve el envío a Publicado/)
    ).toBeTruthy()
  })

  it("sin aviso no hay banner", () => {
    const { container } = render(<AlertBanner shipment={detail()} now={NOW} />)
    expect(container.textContent).toBe("")
  })
})

describe("chat en solo lectura", () => {
  const items = buildChatItems(
    [
      message("Sos un ********", "2026-10-21T15:05:00.000Z", RECEIVER, {
        moderated: true,
      }),
      message("Hola", "2026-10-21T14:00:00.000Z"),
    ],
    [event("delivered", "2026-10-21T14:30:00.000Z")],
    true,
    NOW
  )

  it("sin compositor: no hay dónde escribir", () => {
    render(
      <ChatThread
        items={items}
        reports={[]}
        hasMore={false}
        pending={false}
        failed={null}
        onMore={() => {}}
      />
    )
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.queryByRole("button", { name: /Enviar/ })).toBeNull()
    expect(
      screen.getByText(/Solo lectura · el equipo de Movo no escribe/)
    ).toBeTruthy()
  })

  it("separador de día, tarjeta de evento, mensaje moderado y nota de reporte", () => {
    render(
      <ChatThread
        items={items}
        reports={["Luis reportó esta conversación · 21 oct · 12:16"]}
        hasMore
        pending={false}
        failed={null}
        onMore={() => {}}
      />
    )
    expect(screen.getByText("Hoy")).toBeTruthy()
    expect(screen.getByText("Entregado")).toBeTruthy()
    expect(screen.getByText("Sos un ********")).toBeTruthy()
    expect(screen.getByText("Filtro de lenguaje")).toBeTruthy()
    expect(
      screen.getByText("Luis reportó esta conversación · 21 oct · 12:16")
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Ver mensajes anteriores" })
    ).toBeTruthy()
  })
})
