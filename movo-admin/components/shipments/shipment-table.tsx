import Link from "next/link"
import { ChevronLeft, ChevronRight, SearchX, TriangleAlert } from "lucide-react"
import type { AdminShipmentRow } from "@movo/shared/src/types/admin-shipments"
import { SHIPMENT_STATUS } from "@/lib/users/format"
import {
  addressLine,
  partiesLine,
  pickupWindow,
  priceLabel,
  routeLine,
  rowAlert,
  timeAgo,
} from "@/lib/shipments/format"
import { cn } from "@/lib/utils"
import { SectionEmpty, StatusPill } from "@/components/users/ui"

/**
 * 5 columnas; desde 1320 px suma "Partes" y la ruta muestra la dirección (prototipo). El corte va en
 * rem (82.5rem = 1320 px): Tailwind no puede ordenar un `min-[…px]` contra `md` (rem) y el `md:` le gana.
 */
export const COLUMNS =
  "grid-cols-[104px_minmax(0,1fr)_76px] md:grid-cols-[112px_140px_minmax(0,1fr)_minmax(0,160px)_80px] min-[82.5rem]:grid-cols-[120px_150px_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_86px]"

export function ShipmentTableHeader() {
  return (
    <div
      aria-hidden
      className={cn(
        "grid h-10 items-center gap-4 border-b bg-surface-sub px-[18px] text-xs font-medium text-muted-foreground",
        COLUMNS
      )}
    >
      <span>Envío</span>
      <span className="hidden md:block">Estado</span>
      <span>Ruta</span>
      <span className="hidden min-[82.5rem]:block">Partes</span>
      <span className="hidden md:block">Retiro</span>
      <span className="text-right">Precio</span>
    </div>
  )
}

export function ShipmentRowLink({
  row,
  href,
  now,
}: {
  row: AdminShipmentRow
  href: string
  now: Date
}) {
  const pill = SHIPMENT_STATUS[row.status]
  const alert = rowAlert(row, now)
  return (
    <Link
      href={href}
      className="block border-b outline-none last:border-b-0 hover:bg-surface-sub focus-visible:bg-surface-sub focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span
        className={cn(
          "grid items-center gap-4 px-[18px] pt-3 text-[13px]",
          alert ? "pb-1.5" : "pb-3",
          COLUMNS
        )}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-xs font-medium">#{row.code}</span>
          <span className="text-xs text-muted-foreground">
            {timeAgo(row.lastStatusChangeAt, now)}
          </span>
          <StatusPill
            pill={pill}
            dot={row.status === "in_transit"}
            dotClassName="mv-pulse-dot"
            className="mt-1 self-start md:hidden"
          />
        </span>
        <span className="hidden md:block">
          <StatusPill
            pill={pill}
            dot={row.status === "in_transit"}
            dotClassName="mv-pulse-dot"
          />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{routeLine(row)}</span>
          <span className="truncate text-xs text-muted-foreground min-[82.5rem]:hidden">
            {partiesLine(row)}
          </span>
          <span className="hidden truncate text-xs text-muted-foreground min-[82.5rem]:block">
            {addressLine(row)}
          </span>
        </span>
        <span className="hidden min-w-0 flex-col gap-0.5 min-[82.5rem]:flex">
          <span className="truncate">
            {partiesLine({ ...row, carrier: null })}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {row.carrier
              ? `vía ${row.carrier.name ?? "Sin nombre"}`
              : "Sin transportista"}
          </span>
        </span>
        <span className="hidden min-w-0 text-xs text-fg2 md:block">
          {pickupWindow(row, now)}
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="font-medium tabular-nums">{priceLabel(row)}</span>
          {row.priceKind === "suggested" && (
            <span className="text-[11px] text-muted-foreground">sugerido</span>
          )}
        </span>
      </span>
      {alert && (
        <span className="flex items-center gap-1.5 px-[18px] pb-3 text-xs font-medium text-warn-fg md:pl-[146px] min-[82.5rem]:pl-[154px]">
          <TriangleAlert aria-hidden className="size-3.5 flex-none" />
          {alert}
        </span>
      )}
    </Link>
  )
}

export function ShipmentsEmpty({ filtered }: { filtered: boolean }) {
  return (
    <SectionEmpty
      icon={SearchX}
      title={
        filtered ? "No hay envíos con esos filtros" : "No hay envíos todavía"
      }
      text={filtered ? "Probá con otro estado o borrá la búsqueda." : undefined}
      className="px-6 py-14"
    />
  )
}

/** Paginado del servidor por cursor: "Anterior" vuelve por la pila de cursores de la URL. */
export function ShipmentsPager({
  page,
  prevHref,
  nextHref,
}: {
  page: number
  prevHref: string | null
  nextHref: string | null
}) {
  if (!prevHref && !nextHref) return null
  const link =
    "flex h-8 items-center gap-1 rounded-lg border border-border-strong bg-card px-2.5 text-[13px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
  const off = "pointer-events-none opacity-40"
  return (
    <nav
      aria-label="Páginas"
      className="flex items-center justify-end gap-2 border-t bg-surface-sub px-[18px] py-2.5"
    >
      <span className="mr-auto text-[13px] text-muted-foreground">
        Página {page}
      </span>
      {prevHref ? (
        <Link href={prevHref} className={link} scroll={false}>
          <ChevronLeft aria-hidden className="size-4" />
          Anterior
        </Link>
      ) : (
        <span aria-disabled className={cn(link, off)}>
          <ChevronLeft aria-hidden className="size-4" />
          Anterior
        </span>
      )}
      {nextHref ? (
        <Link href={nextHref} className={link} scroll={false}>
          Siguiente
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : (
        <span aria-disabled className={cn(link, off)}>
          Siguiente
          <ChevronRight aria-hidden className="size-4" />
        </span>
      )}
    </nav>
  )
}
