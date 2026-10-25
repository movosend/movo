import Link from "next/link"
import type { ReactNode } from "react"
import {
  ArrowLeft,
  BadgeCheck,
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  Megaphone,
  PackageCheck,
  PackagePlus,
  Star,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Truck,
  UserCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import type {
  AdminBlock,
  AdminShipmentDetail,
  AdminShipmentEvent,
  AdminShipmentPartyCard,
  AdminShipmentPayment,
} from "@movo/shared/src/types/admin-shipments"
import { formatArs, formatRating, SHIPMENT_STATUS } from "@/lib/users/format"
import {
  ALERT_HINT,
  buildTimeline,
  formatShortDay,
  formatWeight,
  handshakes,
  PACKAGE_TYPE_LABEL,
  paymentLabel,
  pickupWindow,
  priceLabel,
  ROLE_LABEL,
  rowAlert,
  timeAgo,
  type ShipmentStatusValue,
  shipmentDisplayCode,
  type TimelineItem,
} from "@/lib/shipments/format"
import { parseAcceptance } from "@/lib/shipments/offers"
import { UserAvatar } from "@/components/user-avatar"
import { cn } from "@/lib/utils"
import { StatusPill, TONE_BG } from "@/components/users/ui"
import { BlockError } from "./block-error"
import { AcceptedOfferNote } from "./offers"

const card = "flex flex-col gap-3.5 rounded-[10px] border bg-card p-[18px]"

export const EVENT_ICON: Record<ShipmentStatusValue, LucideIcon> = {
  awaiting_receiver_confirmation: PackagePlus,
  rejected_by_receiver: CircleSlash,
  published: Megaphone,
  assignment_pending: UserCheck,
  assigned_unfunded: UserCheck,
  assigned: Wallet,
  in_transit: Truck,
  delivered: PackageCheck,
  completed: BadgeCheck,
  cancelled: CircleX,
  disputed: TriangleAlert,
}

export function DetailHeader({
  shipment,
  backHref,
  now,
  actions,
}: {
  shipment: AdminShipmentDetail
  backHref: string
  now: Date
  actions: ReactNode
}) {
  const pill = SHIPMENT_STATUS[shipment.status]
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2.5">
        <Link
          href={backHref}
          className="flex items-center gap-1.5 self-start rounded text-[13px] font-medium text-fg2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Volver al listado
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl leading-tight font-semibold tracking-[-0.02em]">
            {shipmentDisplayCode(shipment.id)}
          </h1>
          <StatusPill
            pill={pill}
            dot={shipment.status === "in_transit"}
            dotClassName="mv-pulse-dot"
            className="h-[26px] px-[11px] text-[13px]"
          />
          <span className="font-mono text-xs text-muted-foreground">
            {shipment.status}
          </span>
        </div>
        <span className="text-sm text-fg2">
          {shipment.pickupCity ?? "Sin ciudad"} →{" "}
          {shipment.deliveryCity ?? "Sin ciudad"} · {priceLabel(shipment)} ·
          actualizado {timeAgo(shipment.lastStatusChangeAt, now)}
        </span>
      </div>
      <div className="flex gap-2">{actions}</div>
    </div>
  )
}

export function AlertBanner({
  shipment,
  now,
}: {
  shipment: AdminShipmentDetail
  now: Date
}) {
  const alert = rowAlert(shipment, now)
  if (!alert) return null
  const hint = shipment.delayed
    ? ALERT_HINT.in_transit
    : ALERT_HINT[shipment.status]
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-[10px] border border-[var(--warn-border)] bg-warn-soft px-3.5 py-3 text-sm leading-[1.45]"
    >
      <span className="flex size-7 flex-none items-center justify-center rounded-md bg-[var(--warn-icon)] text-[#0a0a0b]">
        <TriangleAlert aria-hidden className="size-4" />
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold">{alert}</span>
        {hint && <span className="text-[13px] text-fg2">{hint}</span>}
      </div>
    </div>
  )
}

const blockCode = (block: AdminBlock<unknown>) =>
  block.error ? `${block.error.code}` : null

export function PartiesCard({
  shipment,
  parties,
}: {
  shipment: AdminShipmentDetail
  parties: AdminBlock<AdminShipmentPartyCard[]>
}) {
  return (
    <section aria-labelledby="partes" className={card}>
      <h2 id="partes" className="text-sm font-semibold">
        Partes
      </h2>
      {parties.error ? (
        <BlockError noun="las partes" code={blockCode(parties)} />
      ) : (
        (["sender", "carrier", "receiver"] as const).map((role) => {
          const party = parties.data.find((p) => p.role === role)
          return party ? (
            <PartyRow key={role} party={party} />
          ) : (
            <EmptyParty
              key={role}
              role={role}
              assigned={role !== "carrier" || !!shipment.carrier}
            />
          )
        })
      )}
    </section>
  )
}

function PartyRow({ party }: { party: AdminShipmentPartyCard }) {
  const verified =
    party.role === "carrier"
      ? party.licenseVerified
        ? "licencia verificada"
        : "licencia sin verificar"
      : party.identityVerified
        ? "identidad verificada"
        : "identidad sin verificar"
  const restricted = party.accountStatus !== "active"
  return (
    <Link
      href={`/users/${party.id}`}
      className="-mx-2 grid grid-cols-[36px_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-1 outline-none hover:bg-surface-sub focus-visible:ring-2 focus-visible:ring-ring"
    >
      <UserAvatar name={party.fullName} photoUrl={party.photoUrl} size={36} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="truncate">{party.fullName}</span>
          <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {ROLE_LABEL[party.role]}
          </span>
          {restricted && (
            <StatusPill
              pill={{
                label: {
                  suspended: "Suspendida",
                  banned: "Inhabilitada",
                  deleted: "Eliminada",
                }[party.accountStatus as "suspended"],
                tone: "danger",
              }}
            />
          )}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {party.reputationScore !== null ? (
            <>
              <Star aria-hidden className="size-3 fill-star text-star" />
              {formatRating(party.reputationScore)} · {party.ratingCount}{" "}
              {party.ratingCount === 1 ? "calificación" : "calificaciones"}
            </>
          ) : (
            "Sin calificaciones"
          )}{" "}
          · {verified}
        </span>
      </span>
    </Link>
  )
}

function EmptyParty({
  role,
  assigned,
}: {
  role: AdminShipmentPartyCard["role"]
  assigned: boolean
}) {
  return (
    <div className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-3 py-1">
      <span
        aria-hidden
        className="flex size-9 items-center justify-center rounded-full border border-dashed border-border-strong text-xs font-semibold text-muted-foreground"
      >
        —
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {assigned ? "Sin datos" : "Sin asignar"}
          <span className="text-[11px] font-semibold tracking-[0.08em] uppercase">
            {ROLE_LABEL[role]}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {assigned ? "No pudimos leer su ficha." : "Esperando ofertas"}
        </span>
      </span>
    </div>
  )
}

export function LegsCard({
  shipment,
  events,
  now,
}: {
  shipment: AdminShipmentDetail
  events: AdminShipmentEvent[] | null
  now: Date
}) {
  const hs = handshakes(shipment, events)
  const receiver = shipment.receiver.name ?? "el receptor"
  const legs = [
    {
      key: "pickup",
      address: shipment.pickupAddress,
      city: shipment.pickupCity,
      when: `Retiro ${pickupWindow(shipment, now).toLowerCase()}`,
      dot: "rounded-[3px] bg-foreground",
      hs: hs.pickup,
    },
    {
      key: "delivery",
      address: shipment.deliveryAddress,
      city: shipment.deliveryCity,
      when: shipment.deliveredAt
        ? `Entregado ${formatShortDay(shipment.deliveredAt)}`
        : `Entrega a ${receiver}`,
      dot: "rounded-full bg-dot-info",
      hs: hs.delivery,
    },
  ]
  return (
    <section aria-labelledby="tramos" className={card}>
      <h2 id="tramos" className="text-sm font-semibold">
        Retiro y entrega
      </h2>
      {legs.map((leg) => (
        <div
          key={leg.key}
          className="grid grid-cols-[12px_minmax(0,1fr)] gap-2.5"
        >
          <span aria-hidden className={cn("mt-[5px] size-2.5", leg.dot)} />
          <div className="flex min-w-0 flex-col gap-[3px]">
            <span className="text-sm font-medium">{leg.address}</span>
            <span className="text-xs text-muted-foreground">
              {leg.city ?? "Sin ciudad"} · {leg.when}
            </span>
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs",
                leg.hs.done ? "text-success-fg" : "text-muted-foreground"
              )}
            >
              {leg.hs.done ? (
                <CircleCheck aria-hidden className="size-[13px]" />
              ) : (
                <Clock aria-hidden className="size-[13px]" />
              )}
              {leg.hs.text}
            </span>
          </div>
        </div>
      ))}
    </section>
  )
}

export function PackagePaymentCard({
  shipment,
  payment,
}: {
  shipment: AdminShipmentDetail
  payment: AdminBlock<AdminShipmentPayment>
}) {
  const facts: Array<[string, ReactNode]> = [
    [
      "Tamaño",
      PACKAGE_TYPE_LABEL[shipment.packageType] ?? shipment.packageType,
    ],
    [
      "Medidas",
      `${shipment.lengthCm} × ${shipment.widthCm} × ${shipment.heightCm} cm`,
    ],
    ["Peso", formatWeight(shipment.weightKg)],
    ["Contenido", shipment.description ?? "—"],
    [
      shipment.agreedPriceArs !== null ? "Precio acordado" : "Precio sugerido",
      shipment.agreedPriceArs !== null
        ? formatArs(shipment.agreedPriceArs)
        : shipment.suggestedPriceArs !== null
          ? formatArs(shipment.suggestedPriceArs)
          : "A estimar",
    ],
  ]
  const hold = payment.data
  return (
    <section aria-labelledby="paquete" className={card}>
      <h2 id="paquete" className="text-sm font-semibold">
        Paquete y pago
      </h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
        {!payment.error && (
          <div className="contents">
            <dt className="text-muted-foreground">Pago</dt>
            <dd className="flex flex-col items-end gap-1 text-right">
              <StatusPill pill={paymentLabel(hold, shipment.status)} />
              {hold && (
                <span className="text-xs text-muted-foreground">
                  {formatArs(hold.amountArs)} · Mercado Pago
                  {hold.cardLast4 &&
                    ` · ${(hold.cardBrand ?? "tarjeta").toUpperCase()} ···· ${hold.cardLast4}`}
                </span>
              )}
              {hold?.status === "authorized" && hold.expiresAt && (
                <span className="text-xs text-muted-foreground">
                  El hold vence el {formatShortDay(hold.expiresAt)}
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>
      {payment.error && <BlockError noun="el pago" code={blockCode(payment)} />}
    </section>
  )
}

/** El evento de aceptación trae `Oferta <id> aceptada · …`: en vez del texto crudo, la oferta elegida. */
const acceptance = (item: TimelineItem) =>
  item.status === "assignment_pending" || item.status === "assigned_unfunded"
    ? parseAcceptance(item.reason)
    : null

export function Timeline({
  shipment,
  events,
}: {
  shipment: AdminShipmentDetail
  events: AdminBlock<AdminShipmentEvent[]>
}) {
  const items = events.data ? buildTimeline(events.data, shipment) : []
  const done = items.filter((i) => !i.pending).length
  const pending = items.length - done
  return (
    <aside
      aria-labelledby="timeline"
      className="flex flex-col rounded-[10px] border bg-card min-[1100px]:sticky min-[1100px]:top-0 min-[1100px]:max-h-[calc(100svh-56px-48px)]"
    >
      <div className="flex items-baseline justify-between border-b px-[18px] py-4">
        <h2 id="timeline" className="text-sm font-semibold">
          Línea de tiempo
        </h2>
        {events.data && (
          <span className="text-xs text-muted-foreground">
            {done} {done === 1 ? "evento" : "eventos"}
            {pending > 0 && ` · ${pending} por venir`}
          </span>
        )}
      </div>
      {events.error && (
        <div className="px-[18px] pt-4 pb-5">
          <BlockError noun="la línea de tiempo" code={blockCode(events)} />
        </div>
      )}
      <ol className="overflow-auto px-[18px] pt-4 pb-5 empty:hidden">
        {items.map((item, i) => {
          const Icon =
            item.kind === "forced"
              ? ShieldAlert
              : item.kind === "manual"
                ? ShieldCheck
                : EVENT_ICON[item.status]
          const last = i === items.length - 1
          const tone = SHIPMENT_STATUS[item.status].tone
          const accepted = acceptance(item)
          return (
            <li
              key={item.key}
              className="flex gap-3.5"
              data-pending={item.pending || undefined}
            >
              <div className="flex flex-none flex-col items-center">
                <span
                  className={cn(
                    "flex size-8 flex-none items-center justify-center rounded-full",
                    item.pending
                      ? "border border-dashed border-border-strong bg-surface-sub text-muted-foreground"
                      : TONE_BG[tone]
                  )}
                >
                  <Icon aria-hidden className="size-[15px]" />
                </span>
                {!last && (
                  <span
                    aria-hidden
                    className={cn(
                      "my-1 min-h-3.5 w-px flex-1",
                      item.pending || items[i + 1]?.pending
                        ? "bg-border"
                        : "bg-border-strong"
                    )}
                  />
                )}
              </div>
              <div
                className={cn(
                  "flex min-w-0 flex-1 flex-col gap-[3px]",
                  !last && "pb-[18px]"
                )}
              >
                <div className="flex min-h-8 flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "text-sm leading-[1.3]",
                      item.pending
                        ? "font-medium text-muted-foreground"
                        : cn(
                            "font-semibold",
                            item.current ? "text-foreground" : "text-fg2"
                          )
                    )}
                  >
                    {item.title}
                    {item.pending && (
                      <span className="sr-only"> (pendiente)</span>
                    )}
                  </span>
                  {item.current && (
                    <span className="inline-flex h-[18px] items-center rounded-full border border-border-strong px-[7px] text-[11px] font-medium text-fg2">
                      Actual
                    </span>
                  )}
                </div>
                {item.meta && (
                  <span className="text-xs text-muted-foreground">
                    {item.meta}
                  </span>
                )}
                {item.detail && (
                  <span className="text-xs text-muted-foreground">
                    {item.detail}
                  </span>
                )}
                {accepted ? (
                  <AcceptedOfferNote {...accepted} />
                ) : (
                  item.reason && (
                    <span className="mt-1 rounded-md border bg-surface-sub px-2.5 py-2 text-[13px] leading-[1.45] text-pretty text-fg2">
                      {item.reason}
                    </span>
                  )
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
