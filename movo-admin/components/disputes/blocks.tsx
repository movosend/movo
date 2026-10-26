import { cache } from "react"
import { Eye, Gavel } from "lucide-react"
import type { AdminDisputeDetailPanel } from "@movo/shared/src/types/admin-disputes-panel"
import { DisputeStatus } from "@movo/shared/src/types/dispute"
import {
  asBlock,
  getDisputeHandshake,
  getDisputeNotes,
  getDisputePhotos,
  getResolutionPreview,
} from "@/lib/disputes/api"
import { getShipment } from "@/lib/shipments/api"
import { BlockError } from "@/components/shipments/block-error"
import { ChatSection } from "@/components/shipments/chat-section"
import { PackagePaymentCard, PartiesCard } from "@/components/shipments/detail"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { HandshakeCard, PhotosCard } from "./expediente"
import { NotesCard } from "./notes-card"
import { ResolveAction, ResolveNotice } from "./resolve-controls"

/**
 * Cada bloque del expediente es un Server Component dentro de su propio `<Suspense>`: se pide por su
 * lado, falla por su lado y «Reintentar» (`router.refresh()`) los vuelve a pedir. Las partes, el pago y el
 * chat salen de la misma lectura del envío (`/admin/shipments/:id`), memoizada por render.
 */
const shipmentOf = cache((shipmentId: string) =>
  asBlock(() => getShipment(shipmentId))
)

export function BlockSkeleton({ className }: { className?: string }) {
  return (
    <SkeletonGroup
      className={`flex flex-col gap-3 rounded-[10px] border bg-card p-[18px] ${className ?? ""}`}
    >
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </SkeletonGroup>
  )
}

const muted =
  "flex h-9 items-center gap-2 rounded-lg border border-dashed border-border-strong px-3.5 text-sm text-fg-disabled"

export function ChatButtonFallback() {
  return (
    <span className={muted} aria-busy>
      <Eye aria-hidden className="size-4" />
      Ver chat
    </span>
  )
}

/** Mientras carga la vista previa: el botón ya ocupa su lugar, deshabilitado (sin saltos en el encabezado). */
export function ResolveButtonFallback() {
  return (
    <span
      className="flex h-9 items-center gap-2 rounded-lg bg-muted px-3.5 text-sm font-medium text-fg-disabled"
      aria-busy
    >
      <Gavel aria-hidden className="size-4" />
      Resolver disputa
    </span>
  )
}

export async function ChatBlock({ shipmentId }: { shipmentId: string }) {
  const block = await shipmentOf(shipmentId)
  if (block.error)
    return (
      <BlockError
        noun="el chat"
        code={block.error.code}
        scope="expediente"
        className="flex items-center gap-3 rounded-lg bg-danger-soft px-3 py-1.5 [&>div>span:nth-child(2)]:hidden"
      />
    )
  return (
    <ChatSection shipment={block.data.shipment} parties={block.data.parties} />
  )
}

export async function PartiesBlock({ shipmentId }: { shipmentId: string }) {
  const block = await shipmentOf(shipmentId)
  if (block.error)
    return (
      <BlockError
        noun="las partes"
        code={block.error.code}
        scope="expediente"
      />
    )
  return (
    <PartiesCard shipment={block.data.shipment} parties={block.data.parties} />
  )
}

export async function PaymentBlock({ shipmentId }: { shipmentId: string }) {
  const block = await shipmentOf(shipmentId)
  if (block.error)
    return (
      <BlockError noun="el pago" code={block.error.code} scope="expediente" />
    )
  return (
    <PackagePaymentCard
      shipment={block.data.shipment}
      payment={block.data.payment}
    />
  )
}

export async function HandshakeBlock({ disputeId }: { disputeId: string }) {
  return (
    <HandshakeCard
      handshake={await asBlock(() => getDisputeHandshake(disputeId))}
    />
  )
}

export async function PhotosBlock({ disputeId }: { disputeId: string }) {
  return (
    <PhotosCard photos={await asBlock(() => getDisputePhotos(disputeId))} />
  )
}

export async function NotesBlock({
  disputeId,
  conflict,
}: {
  disputeId: string
  conflict: boolean
}) {
  const notes = await asBlock(() => getDisputeNotes(disputeId))
  if (notes.error)
    return (
      <BlockError
        noun="las notas internas"
        code={notes.error.code}
        scope="expediente"
      />
    )
  return (
    <NotesCard disputeId={disputeId} initial={notes.data} conflict={conflict} />
  )
}

const namesOf = (dispute: AdminDisputeDetailPanel) => ({
  sender: dispute.sender.name ?? "el emisor",
  carrier: dispute.carrier?.name ?? "el transportista",
})

/** Botón de resolver del encabezado. La vista previa solo se pide con la disputa abierta y sin conflicto. */
export async function ResolveActionBlock({
  dispute,
  conflict,
}: {
  dispute: AdminDisputeDetailPanel
  conflict: boolean
}) {
  const preview =
    dispute.status === DisputeStatus.OPEN && !conflict
      ? await asBlock(() => getResolutionPreview(dispute.id))
      : null
  return (
    <ResolveAction
      disputeId={dispute.id}
      status={dispute.status}
      preview={preview}
      names={namesOf(dispute)}
      conflict={conflict}
    />
  )
}

/** Avisos a lo ancho: admin que es parte, o pago sin confirmar con su reintento. No pide nada al servidor. */
export function ResolveNoticeBlock({
  dispute,
  conflict,
}: {
  dispute: AdminDisputeDetailPanel
  conflict: boolean
}) {
  return (
    <ResolveNotice
      disputeId={dispute.id}
      status={dispute.status}
      resolution={dispute.resolution}
      names={namesOf(dispute)}
      conflict={conflict}
    />
  )
}
