import { Eye } from "lucide-react"
import { ApiError } from "@movo/shared/src/errors/api-error"
import type {
  AdminBlock,
  AdminShipmentDetail,
  AdminShipmentPartyCard,
} from "@movo/shared/src/types/admin-shipments"
import { getShipmentChat } from "@/lib/shipments/api"
import {
  CHAT_ACCESS_LABEL,
  chatTitle,
  reportLine,
  shipmentDisplayCode,
} from "@/lib/shipments/format"
import { BlockError } from "./block-error"
import { ChatPanel } from "./chat-panel"

const muted =
  "flex h-9 items-center gap-2 rounded-lg border border-dashed border-border-strong px-3.5 text-sm text-fg-disabled"

/** Placeholder mientras el chat carga por su lado (no frena el resto del detalle). */
export function ChatButtonLoading() {
  return (
    <span className={muted} aria-busy>
      <Eye aria-hidden className="size-4" />
      Ver chat
    </span>
  )
}

/**
 * El chat se pide aparte del detalle (es otra ruta): si falla, solo este botón muestra el error.
 * Sin transportista no hay hilo (ADR-040).
 */
export async function ChatSection({
  shipment,
  parties,
}: {
  shipment: AdminShipmentDetail
  /** Las fichas ya cargadas del detalle: de ahí salen las fotos de perfil. */
  parties: AdminBlock<AdminShipmentPartyCard[]>
}) {
  if (!shipment.carrier)
    return (
      <span className={muted} title="Sin transportista no hay chat">
        <Eye aria-hidden className="size-4" />
        Sin chat
      </span>
    )
  let page
  try {
    page = await getShipmentChat(shipment.id, null)
  } catch (error) {
    return (
      <BlockError
        noun="el chat"
        code={
          error instanceof ApiError ? `${error.statusCode} ${error.code}` : null
        }
        className="flex items-center gap-3 rounded-lg bg-danger-soft px-3 py-1.5 [&>div>span:nth-child(2)]:hidden"
      />
    )
  }
  const photos = Object.fromEntries(
    (parties.data ?? []).map((p) => [p.id, p.photoUrl])
  )
  const people = [shipment.sender, shipment.carrier, shipment.receiver].map(
    (p) => ({
      id: p.id,
      name: p.name ?? "Sin nombre",
      photoUrl: photos[p.id] ?? null,
    })
  )
  return (
    <ChatPanel
      shipmentId={shipment.id}
      heading={{
        code: shipmentDisplayCode(shipment.id),
        title: chatTitle(shipment),
        people,
        photos,
        mode: `${CHAT_ACCESS_LABEL[page.partiesAccess]}${page.archived ? " · archivado" : ""}`,
        reports: page.reports.map((r) => reportLine(r, shipment)),
      }}
      first={page}
    />
  )
}
