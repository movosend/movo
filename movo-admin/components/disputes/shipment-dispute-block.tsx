import Link from "next/link"
import { ArrowRight, Scale } from "lucide-react"
import { shipmentConfirmationCode } from "@movo/shared/src/types/admin-shipments"
import type { AdminShipmentDetail } from "@movo/shared/src/types/admin-shipments"
import { asBlock, getDispute } from "@/lib/disputes/api"
import {
  ageLabel,
  DISPUTE_REASON_LABEL,
  DISPUTE_STATUS_PILL,
  openedByLabel,
} from "@/lib/disputes/format"
import { BlockError } from "@/components/shipments/block-error"
import { StatusPill } from "@/components/users/ui"

const card = "flex flex-col gap-3 rounded-[10px] border bg-card p-[18px]"
const open =
  "flex h-[38px] items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"

/**
 * Bloque «Disputa» del detalle del envío (MOVO-343): estado, motivo y quién la abrió, con el link al
 * expediente. Sin `disputeId` (un backend que todavía no lo manda) el envío en disputa igual ofrece
 * ir a la bandeja filtrada por su código.
 */
export async function ShipmentDisputeBlock({
  shipment,
  now,
}: {
  shipment: AdminShipmentDetail
  now: Date
}) {
  if (!shipment.disputeId && shipment.status !== "disputed") return null

  if (!shipment.disputeId)
    return (
      <section aria-labelledby="disputa-envio" className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="disputa-envio"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <Scale aria-hidden className="size-4" />
            Disputa
          </h2>
          <Link
            href={`/disputes?${new URLSearchParams({ q: shipmentConfirmationCode(shipment.id), status: "open" })}`}
            className={open}
          >
            Buscar en la bandeja
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
        <p className="text-sm text-fg2">
          Este envío está en disputa. Buscala en la bandeja por su código.
        </p>
      </section>
    )

  const block = await asBlock(() => getDispute(shipment.disputeId!))
  return (
    <section aria-labelledby="disputa-envio" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2
            id="disputa-envio"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <Scale aria-hidden className="size-4" />
            Disputa
          </h2>
          {block.data && (
            <>
              <StatusPill pill={DISPUTE_STATUS_PILL[block.data.status]} />
              <span className="inline-flex h-[22px] items-center rounded-full bg-muted px-[9px] text-xs font-medium text-fg2">
                {DISPUTE_REASON_LABEL[block.data.reason]}
              </span>
            </>
          )}
        </div>
        <Link href={`/disputes/${shipment.disputeId}`} className={open}>
          Abrir expediente
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
      {block.error ? (
        <BlockError noun="la disputa" code={block.error.code} scope="envío" />
      ) : (
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Abierta por</dt>
            <dd>
              {openedByLabel(
                block.data.openedByRole,
                block.data.openedByRole === "sender"
                  ? block.data.sender.name
                  : block.data.openedByRole === "receiver"
                    ? block.data.receiver.name
                    : (block.data.carrier?.name ?? null)
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Antigüedad</dt>
            <dd>{ageLabel(block.data.openedAt, now)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Descargos</dt>
            <dd>{block.data.statements.length}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}
