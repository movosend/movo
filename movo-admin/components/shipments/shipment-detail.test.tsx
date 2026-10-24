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

import type {
  AdminBlock,
  AdminShipmentOffer,
  AdminShipmentPartyCard,
} from "@movo/shared/src/types/admin-shipments"
import { buildChatItems } from "@/lib/shipments/format"
import {
  CARRIER,
  detail,
  event,
  message,
  NOW,
  offer,
  RECEIVER,
  SENDER,
} from "@/lib/shipments/test-fixtures"
import { ChatThread } from "./chat-panel"
import { OffersCard, OffersProvider } from "./offers"
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

describe("ofertas", () => {
  const ACCEPTED = offer()
  const CHEAPER = offer({
    id: "5b0c2d6e-91d4-4c3e-8a0e-0b6f2d41c9a2",
    carrierId: "44444444-4444-4444-8444-444444444444",
    carrierName: "Martina Gómez",
    carrierRatingAtOffer: 3.9,
    status: "superseded",
    priceArs: 6500,
    netArs: 5652.17,
    commissionArs: 847.83,
    mpFeeEstimateArs: 324.35,
    receivedEstimateArs: 5327.82,
    offeredDate: "2026-10-22",
    pickupTimeWindowStart: "14:00",
    pickupTimeWindowEnd: "18:00",
    message: null,
  })
  const withOffers = (
    children: React.ReactNode,
    offers: AdminBlock<AdminShipmentOffer[]> = {
      data: [ACCEPTED, CHEAPER],
      error: null,
    }
  ) => (
    <OffersProvider
      shipment={detail({ suggestedPriceArs: 7300 })}
      offers={offers}
      photos={{}}
    >
      {children}
    </OffersProvider>
  )

  it("resumen con sugerido, acordado contra el sugerido, rango y la elegida", () => {
    render(withOffers(<OffersCard />))
    expect(screen.getByText("2 recibidas · 1 aceptada")).toBeTruthy()
    expect(screen.getByText("$7.300")).toBeTruthy()
    expect(screen.getByText("-7% vs. sugerido")).toBeTruthy()
    expect(screen.getByText("$6.500 – $6.800")).toBeTruthy()
    expect(
      screen.getByRole("img", { name: /2 ofertas entre \$6\.500 y \$6\.800/ })
    ).toBeTruthy()
  })

  it("el modal lista todas, abre en la aceptada y muestra cómo se reparte como en mobile", () => {
    render(withOffers(<OffersCard />))
    fireEvent.click(screen.getByText("Ver todas las ofertas"))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText(/Ofertas del envío/)).toBeTruthy()
    const detailPanel = within(dialog).getByLabelText("Detalle de la oferta")
    expect(within(detailPanel).getByText("Diego Funes")).toBeTruthy()
    expect(within(detailPanel).getByText("Va a recibir aprox.")).toBeTruthy()
    expect(within(detailPanel).getByText("Comisión Movo (15%)")).toBeTruthy()
    expect(within(detailPanel).getByText("− $886,96")).toBeTruthy()
    expect(
      within(detailPanel).getByText("de 2 · $300 más que la más barata")
    ).toBeTruthy()
    expect(within(detailPanel).getByText(ACCEPTED.id)).toBeTruthy()

    fireEvent.click(
      within(dialog).getByRole("button", { name: /Martina Gómez/ })
    )
    expect(within(detailPanel).getByText("Habría recibido aprox.")).toBeTruthy()
    expect(within(detailPanel).getByText("Propone otro día")).toBeTruthy()
    expect(within(detailPanel).getByText("la más barata de 2")).toBeTruthy()
  })

  it("filtra por cómo terminó cada oferta", () => {
    render(withOffers(<OffersCard />))
    fireEvent.click(screen.getByText("Ver todas las ofertas"))
    const dialog = screen.getByRole("dialog")
    // Sin retiradas ni abiertas, esos filtros no aparecen.
    expect(within(dialog).queryByText(/Retiradas o vencidas ·/)).toBeNull()
    expect(within(dialog).queryByText(/Abiertas ·/)).toBeNull()
    expect(within(dialog).getByText("Evaluadas por el emisor · 2")).toBeTruthy()
  })

  it("si el filtro deja afuera a la elegida, el detalle pasa a la primera visible", () => {
    const WITHDRAWN = offer({
      id: "7d1e3f20-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      carrierId: "55555555-5555-4555-8555-555555555555",
      carrierName: "Julián Paz",
      status: "withdrawn",
      priceArs: 7100,
    })
    render(
      withOffers(<OffersCard />, {
        data: [ACCEPTED, CHEAPER, WITHDRAWN],
        error: null,
      })
    )
    fireEvent.click(screen.getByText("Ver todas las ofertas"))
    const dialog = screen.getByRole("dialog")
    const detailPanel = () =>
      within(dialog).getByLabelText("Detalle de la oferta")
    expect(within(detailPanel()).getByText("Diego Funes")).toBeTruthy()
    fireEvent.click(within(dialog).getByText("Retiradas o vencidas · 1"))
    expect(within(detailPanel()).getByText("Julián Paz")).toBeTruthy()
  })

  it("sin ofertas o con el bloque caído", () => {
    render(withOffers(<OffersCard />, { data: [], error: null }))
    expect(screen.getByText("Este envío no recibió ofertas.")).toBeTruthy()
    expect(screen.queryByText("Ver todas las ofertas")).toBeNull()
    cleanup()
    render(withOffers(<OffersCard />, failed))
    expect(screen.getByText("No pudimos cargar las ofertas.")).toBeTruthy()
  })

  it("el evento de aceptación muestra la oferta elegida en vez del motivo crudo y abre el modal en ella", () => {
    render(
      withOffers(
        <Timeline
          shipment={detail({ status: "assignment_pending" })}
          events={{
            data: [
              event("assignment_pending", "2026-10-20T21:12:00.000Z", {
                actorId: SENDER.id,
                reason: `Oferta ${ACCEPTED.id} aceptada · ruta cercana: retiro en 1.7 días (dentro de 3); el emisor paga al aceptar`,
              }),
            ],
            error: null,
          }}
        />
      )
    )
    expect(screen.queryByText(/aceptada · ruta cercana/)).toBeNull()
    expect(screen.getByText("Ruta cercana")).toBeTruthy()
    expect(screen.getByText("Retiro en 1,7 días (N = 3)")).toBeTruthy()
    expect(screen.getByText("2.ª más barata de 2")).toBeTruthy()
    fireEvent.click(screen.getByText("Ver las 2 ofertas"))
    const detailPanel = within(screen.getByRole("dialog")).getByLabelText(
      "Detalle de la oferta"
    )
    expect(within(detailPanel).getByText("Diego Funes")).toBeTruthy()
  })

  it("con el bloque de ofertas caído, el evento deja las etiquetas pero no ofrece abrir el modal", () => {
    render(
      withOffers(
        <Timeline
          shipment={detail({ status: "assignment_pending" })}
          events={{
            data: [
              event("assignment_pending", "2026-10-20T21:12:00.000Z", {
                actorId: SENDER.id,
                reason: `Oferta ${ACCEPTED.id} aceptada · ruta cercana: retiro en 1.7 días (dentro de 3); el emisor paga al aceptar`,
              }),
            ],
            error: null,
          }}
        />,
        failed
      )
    )
    expect(screen.getByText("Ruta cercana")).toBeTruthy()
    expect(screen.queryByText(/^Ver la/)).toBeNull()
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
        photos={{}}
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
        photos={{}}
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
