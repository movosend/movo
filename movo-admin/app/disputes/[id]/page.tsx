import type { Metadata } from "next"
import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { publicError } from "@/lib/auth/api"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { getDispute } from "@/lib/disputes/api"
import { disputeListHref, parseDisputeState } from "@/lib/disputes/params"
import { shipmentDisplayCode } from "@/lib/shipments/format"
import { AdminShell } from "@/components/admin-shell"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  BlockSkeleton,
  ChatBlock,
  ChatButtonFallback,
  ResolveButtonFallback,
  HandshakeBlock,
  NotesBlock,
  PartiesBlock,
  PaymentBlock,
  PhotosBlock,
  ResolveActionBlock,
  ResolveNoticeBlock,
} from "@/components/disputes/blocks"
import {
  AttributionCard,
  DisputeCaseCard,
  ExpedienteHeader,
  PartyHistoryCard,
  ResolutionCard,
} from "@/components/disputes/expediente"
import { ShipmentTrackingMap } from "@/components/shipments/tracking/tracking-panel"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = { title: "Expediente de disputa" }

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  // `from` es la bandeja de origen; se vuelve a armar desde sus filtros para no confiar en el texto.
  const rawFrom = (await searchParams).from
  const from = typeof rawFrom === "string" ? rawFrom : ""
  const backHref = disputeListHref(
    parseDisputeState(Object.fromEntries(new URLSearchParams(from)))
  )
  const self = `/disputes/${id}${from ? `?${new URLSearchParams({ from })}` : ""}`
  const admin = await requireAdmin(false, self)
  const shell = {
    fullName: admin.fullName,
    email: admin.email,
    photoUrl: admin.photoUrl,
    defaultOpen: await sidebarDefaultOpen(),
    current: "/disputes" as const,
  }

  // Única llamada que bloquea: la disputa. Fotos, handshake, notas, partes, pago y chat son bloques aparte.
  let dispute
  try {
    dispute = await getDispute(id)
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
            Volver a la bandeja
          </Link>
        </div>
      </AdminShell>
    )
  }

  const now = new Date()
  // Un admin que es parte del envío ve el expediente pero no resuelve ni escribe notas. El backend lo vuelve a
  // decidir (también cuenta al receptor anterior, que acá no se conoce).
  const conflict = [
    dispute.sender.id,
    dispute.carrier?.id,
    dispute.receiver.id,
  ].includes(admin.id)

  return (
    <AdminShell {...shell} crumb={shipmentDisplayCode(dispute.shipmentId)}>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-5 pt-6 pb-14 md:px-8">
        <ExpedienteHeader
          dispute={dispute}
          backHref={backHref}
          now={now}
          actions={
            <>
              <Suspense fallback={<ChatButtonFallback />}>
                <ChatBlock shipmentId={dispute.shipmentId} />
              </Suspense>
              <Suspense fallback={<ResolveButtonFallback />}>
                <ResolveActionBlock dispute={dispute} conflict={conflict} />
              </Suspense>
            </>
          }
        />
        <ResolveNoticeBlock dispute={dispute} conflict={conflict} />
        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-5">
            {dispute.resolution && dispute.resolution.resolvedAt && (
              <ResolutionCard
                dispute={dispute}
                resolution={dispute.resolution}
              />
            )}
            {dispute.attribution && (
              <AttributionCard attribution={dispute.attribution} />
            )}
            <DisputeCaseCard dispute={dispute} />
            <ShipmentTrackingMap shipmentId={dispute.shipmentId} />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-start gap-5">
              <Suspense fallback={<BlockSkeleton />}>
                <HandshakeBlock disputeId={dispute.id} />
              </Suspense>
              <Suspense fallback={<BlockSkeleton />}>
                <PhotosBlock disputeId={dispute.id} />
              </Suspense>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <Suspense fallback={<BlockSkeleton />}>
              <NotesBlock disputeId={dispute.id} conflict={conflict} />
            </Suspense>
            <PartyHistoryCard dispute={dispute} />
            <Suspense fallback={<BlockSkeleton />}>
              <PartiesBlock shipmentId={dispute.shipmentId} />
            </Suspense>
            <Suspense fallback={<BlockSkeleton />}>
              <PaymentBlock shipmentId={dispute.shipmentId} />
            </Suspense>
          </div>
        </div>
      </div>
    </AdminShell>
  )
}
