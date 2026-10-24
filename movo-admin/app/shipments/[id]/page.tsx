import type { Metadata } from "next"
import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { publicError } from "@/lib/auth/api"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { getShipment } from "@/lib/shipments/api"
import { listHref, parseListState } from "@/lib/shipments/params"
import { AdminShell } from "@/components/admin-shell"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  ChatButtonLoading,
  ChatSection,
} from "@/components/shipments/chat-section"
import {
  AlertBanner,
  DetailHeader,
  LegsCard,
  PackagePaymentCard,
  PartiesCard,
  Timeline,
} from "@/components/shipments/detail"
import { ShipmentTrackingMap } from "@/components/shipments/tracking/tracking-panel"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = { title: "Detalle del envío" }

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  // `from` es el listado de origen; se vuelve a armar desde sus filtros para no confiar en el texto.
  const rawFrom = (await searchParams).from
  const from = typeof rawFrom === "string" ? rawFrom : ""
  const backHref = listHref(
    parseListState(Object.fromEntries(new URLSearchParams(from)))
  )
  const self = `/shipments/${id}${from ? `?${new URLSearchParams({ from })}` : ""}`
  const admin = await requireAdmin(false, self)
  const shell = {
    fullName: admin.fullName,
    email: admin.email,
    photoUrl: admin.photoUrl,
    defaultOpen: await sidebarDefaultOpen(),
    current: "/shipments" as const,
  }

  // Única llamada que bloquea: el envío. Eventos, pago y partes son bloques con su propio error.
  let detail
  try {
    detail = await getShipment(id)
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) notFound()
    return (
      <AdminShell {...shell}>
        <div className="mx-auto flex max-w-[1440px] flex-col items-start gap-4 px-5 pt-6 pb-16 md:px-8">
          <Alert variant="destructive" className="w-auto">
            <AlertDescription>{publicError(error)}</AlertDescription>
          </Alert>
          <Link
            href={self}
            className="text-sm font-medium underline underline-offset-4"
          >
            Reintentar
          </Link>
          <Link
            href={backHref}
            className="text-sm text-fg2 hover:text-foreground"
          >
            Volver al listado
          </Link>
        </div>
      </AdminShell>
    )
  }

  const { shipment } = detail
  const now = new Date()
  return (
    <AdminShell {...shell} crumb={`#${shipment.code}`}>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-5 pt-6 pb-14 md:px-8">
        <DetailHeader
          shipment={shipment}
          backHref={backHref}
          now={now}
          actions={
            <Suspense fallback={<ChatButtonLoading />}>
              <ChatSection shipment={shipment} />
            </Suspense>
          }
        />
        <AlertBanner shipment={shipment} now={now} />
        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-5">
            <ShipmentTrackingMap shipmentId={shipment.id} />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-5">
              <PartiesCard shipment={shipment} parties={detail.parties} />
              <LegsCard
                shipment={shipment}
                events={detail.events.data}
                now={now}
              />
              <PackagePaymentCard
                shipment={shipment}
                payment={detail.payment}
              />
            </div>
          </div>
          <Timeline shipment={shipment} events={detail.events} />
        </div>
      </div>
    </AdminShell>
  )
}
