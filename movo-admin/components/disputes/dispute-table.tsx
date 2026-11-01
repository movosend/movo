import Link from "next/link"
import { Bot, SearchX } from "lucide-react"
import type { AdminDisputeRow } from "@movo/shared/src/types/admin-disputes"
import {
  ageLabel,
  DISPUTE_REASON_LABEL,
  DISPUTE_STATUS_PILL,
  isSystemReason,
  openedByLabel,
} from "@/lib/disputes/format"
import { SHIPMENT_STATUS } from "@/lib/users/format"
import { cn } from "@/lib/utils"
import { SectionEmpty, StatusPill } from "@/components/users/ui"

/** Una fila: disputa, partes, motivo, ciudad del retiro y antigüedad. Desde 1100 px suma "Partes". */
export const DISPUTE_COLUMNS =
  "grid-cols-[112px_minmax(0,1fr)_104px] md:grid-cols-[112px_minmax(0,1.1fr)_minmax(0,1fr)_120px] min-[68.75rem]:grid-cols-[112px_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_120px]"

export function DisputeTableHeader() {
  return (
    <div
      aria-hidden
      className={cn(
        "grid h-10 items-center gap-4 border-b bg-surface-sub px-[18px] text-xs font-medium text-muted-foreground",
        DISPUTE_COLUMNS
      )}
    >
      <span>Envío</span>
      <span>Motivo</span>
      <span className="hidden md:block">Abierta por</span>
      <span className="hidden min-[68.75rem]:block">Partes</span>
      <span className="text-right">Antigüedad</span>
    </div>
  )
}

export function DisputeRowLink({
  row,
  href,
  now,
}: {
  row: AdminDisputeRow & Partial<Pick<AdminDisputeRow, "pickupCity">>
  href: string
  now: Date
}) {
  const system = isSystemReason(row.reason)
  const opener =
    row.openedByRole === null
      ? null
      : row.openedByRole === "sender"
        ? row.sender
        : row.openedByRole === "receiver"
          ? row.receiver
          : row.carrier
  return (
    <Link
      href={href}
      className="block border-b outline-none last:border-b-0 hover:bg-surface-sub focus-visible:bg-surface-sub focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span
        className={cn(
          "grid items-center gap-4 px-[18px] py-3 text-[13px]",
          DISPUTE_COLUMNS
        )}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-xs font-medium">
            #{row.shipmentCode}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {row.pickupCity ?? "Sin ciudad"}
          </span>
        </span>
        <span className="flex min-w-0 flex-col items-start gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex h-[22px] items-center gap-1 rounded-full px-[9px] text-xs font-medium",
                system
                  ? "border border-dashed border-border-strong bg-card text-fg2"
                  : "bg-muted text-fg2"
              )}
            >
              {system && <Bot aria-hidden className="size-3" />}
              {DISPUTE_REASON_LABEL[row.reason]}
            </span>
            {row.status !== "open" && (
              <StatusPill pill={DISPUTE_STATUS_PILL[row.status]} />
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground md:hidden">
            {openedByLabel(row.openedByRole, opener?.name ?? null)}
          </span>
          <span className="text-xs text-muted-foreground">
            Envío:{" "}
            {SHIPMENT_STATUS[
              row.shipmentStatusAtOpen as keyof typeof SHIPMENT_STATUS
            ]?.label ?? row.shipmentStatusAtOpen}
          </span>
        </span>
        <span className="hidden min-w-0 truncate md:block">
          {openedByLabel(row.openedByRole, opener?.name ?? null)}
        </span>
        <span className="hidden min-w-0 flex-col gap-0.5 min-[68.75rem]:flex">
          <span className="truncate">
            {row.sender.name ?? "Sin nombre"} →{" "}
            {row.receiver.name ?? "Sin nombre"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {row.carrier
              ? `vía ${row.carrier.name ?? "Sin nombre"}`
              : "Sin transportista"}
          </span>
        </span>
        <span className="text-right text-xs text-fg2 tabular-nums">
          {ageLabel(row.openedAt, now)}
        </span>
      </span>
    </Link>
  )
}

export function DisputesEmpty({ filtered }: { filtered: boolean }) {
  return (
    <SectionEmpty
      icon={SearchX}
      title={
        filtered ? "No hay disputas con esos filtros" : "No hay disputas acá"
      }
      text={
        filtered
          ? "Probá con otro estado o borrá la búsqueda."
          : "Cuando una parte o el sistema abra una, aparece en esta lista."
      }
      className="px-6 py-14"
    />
  )
}
