"use client"
import { useRef, useState, useTransition } from "react"
import { ArrowUpRight, Route, RotateCw, TriangleAlert } from "lucide-react"
import type {
  AdminShipmentRole,
  AdminUserShipment,
  AdminUserShipmentPage,
  AdminUserTrip,
  AdminUserTripPage,
} from "@movo/shared/src/types/admin-users"
import {
  formatDate,
  formatDateTime,
  formatArs,
  SHIPMENT_STATUS,
  TRIP_STATUS,
} from "@/lib/users/format"
import { loadActivityPage, type ActivityTab } from "@/app/users/[id]/actions"
import { Button } from "@/components/ui/button"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { ReportSection } from "../ficha-status"
import { Pager } from "../pager"
import { Segmented } from "../segmented"
import { SectionEmpty, SectionShell, StatusPill } from "../ui"
import { cn } from "@/lib/utils"
import { shipmentHref } from "@/lib/support/shipment-href"

const PAGE_SIZE = 5

type Data = AdminUserShipmentPage | AdminUserTripPage
const isShipments = (d: Data): d is AdminUserShipmentPage => "counts" in d

const EMPTY: Record<ActivityTab, [string, string]> = {
  sender: ["Nunca envió", "No publicó ningún envío."],
  carrier: ["Nunca transportó", "Todavía no llevó ningún paquete."],
  receiver: ["Nunca recibió", "Nadie le mandó un paquete por Movo."],
  trips: ["Sin viajes", "Nunca declaró un viaje."],
}

function others(s: AdminUserShipment): string {
  const carrier = s.carrier?.fullName ?? "sin asignar"
  if (s.userRole === "sender")
    return `Transportista: ${carrier} · Receptor: ${s.receiver.fullName}`
  if (s.userRole === "carrier")
    return `Emisor: ${s.sender.fullName} · Receptor: ${s.receiver.fullName}`
  return `Emisor: ${s.sender.fullName} · Transportista: ${carrier}`
}

const COLS =
  "grid-cols-[110px_136px_minmax(0,1fr)_76px] min-[1180px]:grid-cols-[130px_150px_minmax(0,1fr)_110px_90px]"

function ShipmentRow({ s }: { s: AdminUserShipment }) {
  const href = shipmentHref(s.id)
  const pill = SHIPMENT_STATUS[s.status]
  const code = (
    <span
      title={s.id}
      className="flex items-center gap-1.5 font-mono text-xs font-medium"
    >
      #{s.shortId}
      {href && (
        <ArrowUpRight
          aria-hidden
          className="size-[13px] text-muted-foreground"
        />
      )}
    </span>
  )
  const body = (
    <>
      {href ? (
        <span className="underline decoration-1 underline-offset-[3px]">
          {code}
        </span>
      ) : (
        code
      )}
      <span>
        <StatusPill pill={pill} dot />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium">
          {s.pickupAddress} → {s.deliveryAddress}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {others(s)}
        </span>
      </span>
      <span className="hidden text-xs whitespace-nowrap text-fg2 min-[1180px]:block">
        {formatDate(s.createdAt)}
      </span>
      <span className="text-right font-medium tabular-nums">
        {s.priceArs === null ? "—" : formatArs(s.priceArs)}
      </span>
    </>
  )
  const cls = cn(
    "grid items-center gap-4 border-b px-[18px] py-3 text-[13px]",
    COLS
  )
  return href ? (
    <a href={href} className={cn(cls, "hover:bg-surface-sub")}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function TripRow({ t }: { t: AdminUserTrip }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-4 border-b px-[18px] py-3 text-[13px] min-[1180px]:grid-cols-[minmax(0,1fr)_150px_130px]">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium">
          {t.originAddress} → {t.destinationAddress}
        </span>
        <span className="text-xs text-muted-foreground">
          {t.vehicleType}
          {t.recurring ? " · recurrente" : ""}
        </span>
      </span>
      <span>
        <StatusPill pill={TRIP_STATUS[t.status]} dot />
      </span>
      <span className="hidden text-xs text-fg2 min-[1180px]:block">
        Sale {formatDateTime(t.departureAt)}
      </span>
    </div>
  )
}

export function ActivityPanel({
  userId,
  initialTab,
  initial,
}: {
  userId: string
  initialTab: AdminShipmentRole
  initial: AdminUserShipmentPage
}) {
  const [tab, setTab] = useState<ActivityTab>(initialTab)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Data>(initial)
  const [failed, setFailed] = useState<number | null>(null)
  const [pending, start] = useTransition()
  const [counts, setCounts] = useState(initial.counts)
  const latest = useRef(0)

  const fetchPage = (next: ActivityTab, nextPage: number) =>
    start(async () => {
      const ticket = ++latest.current
      const result = await loadActivityPage(userId, next, nextPage)
      if (ticket !== latest.current) return
      if (!result.ok) return setFailed(result.status)
      setFailed(null)
      setTab(next)
      setPage(nextPage)
      setData(result.data)
      if (isShipments(result.data)) setCounts(result.data.counts)
    })

  const select = (next: ActivityTab) => {
    if (next === tab && !failed) return
    setTab(next)
    setPage(1)
    setFailed(null)
    fetchPage(next, 1)
  }

  const total = counts.sender + counts.carrier + counts.receiver
  const asCarrier = counts.carrier
  const rows = isShipments(data) ? data.items : null
  const trips = isShipments(data) ? null : data.items

  return (
    <SectionShell
      id="actividad"
      aside={
        <>
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {total} {total === 1 ? "envío" : "envíos"}
          </span>
          <span className="flex-1" />
          <Segmented
            label="Actividad"
            value={tab}
            onChange={select}
            options={[
              { value: "sender", label: "Como emisor", count: counts.sender },
              {
                value: "carrier",
                label: "Como transportista",
                count: counts.carrier,
              },
              {
                value: "receiver",
                label: "Como receptor",
                count: counts.receiver,
              },
              { value: "trips", label: "Viajes" },
            ]}
          />
        </>
      }
    >
      <ReportSection
        id="actividad"
        status="ready"
        count={total}
        kpi={{
          value: String(total),
          sub: asCarrier ? `${asCarrier} transportados` : undefined,
        }}
      />
      <div aria-busy={pending}>
        {pending ? (
          <SkeletonGroup className="flex flex-col gap-3.5 p-[18px]">
            {[90, 84, 88].map((w) => (
              <Skeleton key={w} className="h-3.5" style={{ width: `${w}%` }} />
            ))}
          </SkeletonGroup>
        ) : failed ? (
          <div
            role="alert"
            className="m-[18px] flex flex-wrap items-start gap-3 rounded-lg bg-danger-soft p-3.5"
          >
            <TriangleAlert
              aria-hidden
              className="mt-px size-[18px] text-danger-fg"
            />
            <div className="flex min-w-[200px] flex-1 flex-col gap-1">
              <span className="text-sm font-medium">
                No pudimos cargar esta página.
              </span>
              <span className="text-[13px] text-fg2">
                El resto de la ficha no se ve afectado.
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                GET /admin/users/{userId.slice(0, 8)}…/
                {tab === "trips" ? "trips" : "shipments"} · {failed}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => fetchPage(tab, page)}
            >
              <RotateCw aria-hidden /> Reintentar
            </Button>
          </div>
        ) : (
          <>
            {rows?.map((s) => (
              <ShipmentRow key={s.id} s={s} />
            ))}
            {trips?.map((t) => (
              <TripRow key={t.id} t={t} />
            ))}
            {data.items.length === 0 && (
              <SectionEmpty
                icon={Route}
                title={EMPTY[tab][0]}
                text={EMPTY[tab][1]}
              />
            )}
          </>
        )}
      </div>
      {data.total > PAGE_SIZE && !failed && (
        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={data.total}
          size={30}
          disabled={pending}
          onChange={(n) => fetchPage(tab, n)}
        />
      )}
    </SectionShell>
  )
}
