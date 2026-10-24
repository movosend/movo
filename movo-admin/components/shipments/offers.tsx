"use client"

import Link from "next/link"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Check, Copy, Star } from "lucide-react"
import type {
  AdminBlock,
  AdminShipmentDetail,
  AdminShipmentOffer,
} from "@movo/shared/src/types/admin-shipments"
import { formatArs, formatRating } from "@/lib/users/format"
import { formatStamp, shipmentDisplayCode } from "@/lib/shipments/format"
import {
  commissionLabel,
  deltaLabel,
  deltaShort,
  formatDuration,
  inFilter,
  OFFER_FILTERS,
  OFFER_SORTS,
  OFFER_STATUS,
  offerDelivery,
  offerLife,
  offerPickup,
  priceRank,
  rankLabel,
  receivedLabel,
  requestedPickup,
  sortOffers,
  suggestedDelta,
  summarizeOffers,
  type OfferFilter,
  type OfferSort,
} from "@/lib/shipments/offers"
import { cn } from "@/lib/utils"
import { UserAvatar } from "@/components/user-avatar"
import { StatusPill } from "@/components/users/ui"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { BlockError } from "./block-error"

interface OffersContextValue {
  shipment: AdminShipmentDetail
  offers: AdminBlock<AdminShipmentOffer[]>
  /** Foto actual de cada transportista que es parte del envío (las ofertas solo traen el snapshot del nombre). */
  photos: Record<string, string | null>
  open: (offerId?: string) => void
}

const OffersContext = createContext<OffersContextValue | null>(null)

function useOffers(): OffersContextValue {
  const value = useContext(OffersContext)
  if (!value) throw new Error("useOffers fuera de <OffersProvider>")
  return value
}

/**
 * Dueño del modal de ofertas: lo abren la sección "Ofertas" y el evento de aceptación de la línea de
 * tiempo, que viven en columnas distintas del detalle.
 */
export function OffersProvider({
  shipment,
  offers,
  photos,
  children,
}: Omit<OffersContextValue, "open"> & { children: ReactNode }) {
  const [openWith, setOpenWith] = useState<{ offerId: string | null } | null>(
    null
  )
  const value = useMemo(
    () => ({
      shipment,
      offers,
      photos,
      open: (offerId?: string) => setOpenWith({ offerId: offerId ?? null }),
    }),
    [shipment, offers, photos]
  )
  return (
    <OffersContext.Provider value={value}>
      {children}
      <Dialog
        open={openWith !== null}
        onOpenChange={(next) => {
          if (!next) setOpenWith(null)
        }}
      >
        {openWith && (
          <DialogContent className="top-6 max-h-[calc(100svh-48px)] w-[calc(100%-32px)] max-w-[1180px] -translate-y-0">
            <OffersDialogBody initialOfferId={openWith.offerId} />
          </DialogContent>
        )}
      </Dialog>
    </OffersContext.Provider>
  )
}

/** Botón con forma de link que abre el modal (en una oferta puntual, si se pasa). */
export function ViewOffersButton({
  offerId,
  children,
}: {
  offerId?: string
  children: ReactNode
}) {
  const { open } = useOffers()
  return (
    <button
      type="button"
      onClick={() => open(offerId)}
      className="self-start rounded text-[13px] font-medium text-info-fg underline underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}

const tile = "flex flex-col gap-0.5 bg-card px-[18px] py-3.5"
const tileLabel = "text-xs text-muted-foreground"
const tileValue = "text-xl font-semibold tabular-nums"

function DeltaPill({ delta }: { delta: number | null }) {
  if (delta === null) return null
  return (
    <span className="inline-flex h-[22px] items-center self-start rounded-full bg-muted px-[9px] text-xs font-semibold whitespace-nowrap text-fg2">
      {deltaLabel(delta)}
    </span>
  )
}

export function OffersCard() {
  const { shipment, offers, photos, open } = useOffers()
  const list = offers.data ?? []
  const summary = summarizeOffers(list)
  return (
    <section
      aria-labelledby="ofertas"
      className="rounded-[10px] border bg-card"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b px-[18px] py-4">
        <h2 id="ofertas" className="text-sm font-semibold">
          Ofertas
        </h2>
        {summary && (
          <span className="text-xs text-muted-foreground">
            {summary.count} {summary.count === 1 ? "recibida" : "recibidas"}
            {summary.accepted && " · 1 aceptada"}
            {summary.pending > 0 &&
              ` · ${summary.pending} ${summary.pending === 1 ? "abierta" : "abiertas"}`}
            {summary.dropped > 0 &&
              ` · ${summary.dropped} retiradas o vencidas`}
          </span>
        )}
        {summary && (
          <button
            type="button"
            onClick={() => open()}
            className="ml-auto inline-flex h-9 items-center rounded-lg border border-border-strong bg-card px-3.5 text-[13px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            Ver todas las ofertas
          </button>
        )}
      </div>

      {offers.error ? (
        <div className="p-[18px]">
          <BlockError noun="las ofertas" code={offers.error.code} />
        </div>
      ) : !summary ? (
        <p className="px-[18px] py-5 text-[13px] text-muted-foreground">
          {shipment.status === "awaiting_receiver_confirmation" ||
          shipment.status === "rejected_by_receiver"
            ? "Se publica para los transportistas cuando el receptor lo acepta."
            : shipment.status === "published"
              ? "Todavía no hay ofertas."
              : "Este envío no recibió ofertas."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-px border-b bg-border">
            <div className={tile}>
              <span className={tileLabel}>Precio sugerido</span>
              <span className={tileValue}>
                {shipment.suggestedPriceArs !== null
                  ? formatArs(shipment.suggestedPriceArs)
                  : "A estimar"}
              </span>
            </div>
            <div className={tile}>
              <span className={tileLabel}>Precio acordado</span>
              <span className={tileValue}>
                {shipment.agreedPriceArs !== null
                  ? formatArs(shipment.agreedPriceArs)
                  : "Sin acordar"}
              </span>
              {shipment.agreedPriceArs !== null && (
                <DeltaPill
                  delta={suggestedDelta(
                    shipment.agreedPriceArs,
                    shipment.suggestedPriceArs
                  )}
                />
              )}
            </div>
            <div className={tile}>
              <span className={tileLabel}>Rango ofertado</span>
              <span className={tileValue}>
                {summary.minArs === summary.maxArs
                  ? formatArs(summary.minArs)
                  : `${formatArs(summary.minArs)} – ${formatArs(summary.maxArs)}`}
              </span>
              <span className="text-xs text-muted-foreground">
                Mediana {formatArs(Math.round(summary.medianArs))}
              </span>
            </div>
            <div className={tile}>
              <span className={tileLabel}>Tiempo hasta elegir</span>
              <span className={tileValue}>
                {summary.timeToChooseMs !== null
                  ? formatDuration(summary.timeToChooseMs)
                  : "Sin elegir"}
              </span>
              <span className="text-xs text-muted-foreground">
                desde la primera oferta
              </span>
            </div>
          </div>

          <div className="px-[18px] pt-[18px] pb-2">
            <PriceStrip
              offers={list}
              suggestedArs={shipment.suggestedPriceArs}
            />
          </div>

          {summary.accepted && (
            <div className="mx-[18px] mt-2 mb-[18px] flex flex-wrap items-center gap-3 rounded-lg border bg-surface-sub px-3.5 py-3">
              <UserAvatar
                name={summary.accepted.carrierName ?? "Sin nombre"}
                photoUrl={photos[summary.accepted.carrierId] ?? null}
                size={32}
              />
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">
                  {summary.accepted.carrierName ?? "Sin nombre"}{" "}
                  <RatingAtOffer offer={summary.accepted} />
                </span>
                <span className="text-xs text-muted-foreground">
                  Retira {offerPickup(summary.accepted, shipment).when} ·
                  entrega estimada{" "}
                  {offerDelivery(summary.accepted).toLowerCase()}
                </span>
              </div>
              <span className="ml-auto flex items-center gap-3">
                <StatusPill pill={OFFER_STATUS.accepted} />
                <ViewOffersButton offerId={summary.accepted.id}>
                  Ver detalle
                </ViewOffersButton>
              </span>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function RatingAtOffer({ offer }: { offer: AdminShipmentOffer }) {
  return (
    <span className="font-normal text-muted-foreground">
      ·{" "}
      {offer.carrierRatingAtOffer !== null ? (
        <>
          <Star
            aria-hidden
            className="mb-px inline size-3 fill-star text-star"
          />{" "}
          {formatRating(offer.carrierRatingAtOffer)} al ofertar
        </>
      ) : (
        "sin calificaciones al ofertar"
      )}
    </span>
  )
}

/** Cada oferta como un punto sobre una línea de precios, con la marca del sugerido. */
function PriceStrip({
  offers,
  suggestedArs,
}: {
  offers: AdminShipmentOffer[]
  suggestedArs: number | null
}) {
  const prices = offers.map((o) => o.priceArs)
  const all = suggestedArs !== null ? [...prices, suggestedArs] : prices
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const pad = hi > lo ? (hi - lo) * 0.12 : Math.max(hi * 0.1, 1)
  const min = lo - pad
  const max = hi + pad
  const left = (value: number) => `${((value - min) / (max - min)) * 100}%`
  const accepted = offers.find((o) => o.status === "accepted")
  const label =
    `${offers.length} ${offers.length === 1 ? "oferta" : "ofertas"} entre ${formatArs(Math.min(...prices))} y ${formatArs(Math.max(...prices))}` +
    (suggestedArs !== null ? `; sugerido ${formatArs(suggestedArs)}` : "") +
    (accepted ? `; aceptada ${formatArs(accepted.priceArs)}` : "")
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {suggestedArs !== null
            ? "Ofertas sobre el precio sugerido"
            : "Ofertas por precio"}
        </span>
        <span className="flex flex-wrap gap-3.5">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full bg-dot-info" />
            Aceptada
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-full border-2 border-muted-foreground"
            />
            Otras
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-full border-2 border-dashed border-muted-foreground"
            />
            Retiradas o vencidas
          </span>
        </span>
      </div>
      <div role="img" aria-label={label} className="relative h-14">
        <div className="absolute inset-x-0 top-7 h-0.5 rounded-full bg-border-strong" />
        {suggestedArs !== null && (
          <>
            <div
              className="absolute top-1 bottom-1 w-0 border-l border-dashed border-fg2"
              style={{ left: left(suggestedArs) }}
            />
            <span
              className="absolute -top-0.5 -translate-x-1/2 text-[11px] whitespace-nowrap text-fg2"
              style={{ left: left(suggestedArs) }}
            >
              Sugerido
            </span>
          </>
        )}
        {offers.map((offer) => {
          const isAccepted = offer.status === "accepted"
          return (
            <span
              key={offer.id}
              title={`${offer.carrierName ?? "Sin nombre"} · ${formatArs(offer.priceArs)}`}
              className={cn(
                "absolute top-[29px] -translate-x-1/2 -translate-y-1/2 rounded-full",
                isAccepted
                  ? "z-10 size-4 bg-dot-info ring-4 ring-info-soft"
                  : cn(
                      "size-3 border-2 border-muted-foreground bg-card",
                      inFilter(offer, "dropped") && "border-dashed opacity-70"
                    )
              )}
              style={{ left: left(offer.priceArs) }}
            />
          )
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{formatArs(Math.round(min))}</span>
        <span>{formatArs(Math.round(max))}</span>
      </div>
    </div>
  )
}

const sectionLabel =
  "text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase"

function OffersDialogBody({
  initialOfferId,
}: {
  initialOfferId: string | null
}) {
  const { shipment, offers, photos } = useOffers()
  const list = useMemo(() => offers.data ?? [], [offers.data])
  const summary = summarizeOffers(list)
  const [filter, setFilter] = useState<OfferFilter>("all")
  const [sort, setSort] = useState<OfferSort>("price")
  const [selectedId, setSelectedId] = useState<string | null>(
    initialOfferId ?? summary?.accepted?.id ?? null
  )
  const rows = sortOffers(
    list.filter((o) => inFilter(o, filter)),
    sort
  )
  // La elegida tiene que estar en la lista que se ve: si el filtro la saca, pasa a la primera visible.
  const selected = rows.find((o) => o.id === selectedId) ?? rows[0] ?? null
  const filters = (Object.keys(OFFER_FILTERS) as OfferFilter[])
    .map((key) => ({
      key,
      count: list.filter((o) => inFilter(o, key)).length,
    }))
    .filter((f) => f.key === "all" || f.count > 0)

  return (
    <>
      <DialogHeader className="border-b pb-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <DialogTitle className="text-base">
            Ofertas del envío{" "}
            <span className="font-mono">
              {shipmentDisplayCode(shipment.id)}
            </span>
          </DialogTitle>
          <DialogDescription>
            {summary
              ? [
                  `${summary.count} ${summary.count === 1 ? "oferta" : "ofertas"}`,
                  shipment.suggestedPriceArs !== null &&
                    `sugerido ${formatArs(shipment.suggestedPriceArs)}`,
                  summary.accepted &&
                    `acordado ${formatArs(summary.accepted.priceArs)} con ${summary.accepted.carrierName ?? "el transportista"}${summary.accepted.respondedAt ? ` el ${formatStamp(summary.accepted.respondedAt)}` : ""}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Sin ofertas"}
          </DialogDescription>
        </div>
      </DialogHeader>

      {offers.error ? (
        <DialogBody>
          <BlockError noun="las ofertas" code={offers.error.code} />
        </DialogBody>
      ) : !summary ? (
        <DialogBody>
          <p className="text-[13px] text-muted-foreground">
            Este envío no recibió ofertas.
          </p>
        </DialogBody>
      ) : (
        <>
          <div className="border-b px-5 pt-4 pb-3">
            <PriceStrip
              offers={list}
              suggestedArs={shipment.suggestedPriceArs}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "h-[30px] rounded-full border px-3 text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  filter === f.key
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border-strong text-fg2 hover:bg-muted"
                )}
              >
                {OFFER_FILTERS[f.key].label} · {f.count}
              </button>
            ))}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Ordenar por</span>
              {(Object.keys(OFFER_SORTS) as OfferSort[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={sort === key}
                  onClick={() => setSort(key)}
                  className={cn(
                    "h-[30px] rounded-full border px-3 text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    sort === key
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border-strong text-fg2 hover:bg-muted"
                  )}
                >
                  {OFFER_SORTS[key]}
                </button>
              ))}
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-wrap overflow-auto">
            <div className="min-w-0 flex-[999_1_560px] px-3 pt-2.5 pb-4">
              <div
                aria-hidden
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3.5 py-1.5 text-xs text-muted-foreground md:grid-cols-[minmax(170px,1.5fr)_96px_64px_minmax(150px,1.3fr)_120px]"
              >
                <span>Transportista</span>
                <span className="text-right">Precio</span>
                <span className="hidden text-right md:block">vs sugerido</span>
                <span className="hidden md:block">Retiro propuesto</span>
                <span className="hidden md:block">Estado</span>
              </div>
              <ul className="flex flex-col">
                {rows.map((offer) => {
                  const pickup = offerPickup(offer, shipment)
                  const delta = suggestedDelta(
                    offer.priceArs,
                    shipment.suggestedPriceArs
                  )
                  const isSelected = offer.id === selected?.id
                  return (
                    <li key={offer.id}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedId(offer.id)}
                        className={cn(
                          "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3.5 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(170px,1.5fr)_96px_64px_minmax(150px,1.3fr)_120px]",
                          isSelected
                            ? "border-border-strong bg-muted"
                            : "border-transparent hover:bg-surface-sub"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <UserAvatar
                            name={offer.carrierName ?? "Sin nombre"}
                            photoUrl={photos[offer.carrierId] ?? null}
                            size={32}
                          />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-sm font-semibold">
                              {offer.carrierName ?? "Sin nombre"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {offer.carrierRatingAtOffer !== null
                                ? `★ ${formatRating(offer.carrierRatingAtOffer)}`
                                : "Sin calificar"}{" "}
                              · {formatStamp(offer.createdAt)}
                            </span>
                          </span>
                        </span>
                        <span className="text-right text-sm font-semibold tabular-nums">
                          {formatArs(offer.priceArs)}
                        </span>
                        <span className="hidden text-right text-xs font-medium text-muted-foreground tabular-nums md:block">
                          {delta !== null ? deltaShort(delta) : "—"}
                        </span>
                        <span className="hidden flex-col text-[13px] md:flex">
                          <span>{pickup.when}</span>
                          <span className="text-xs text-muted-foreground">
                            {pickup.note}
                          </span>
                        </span>
                        <span className="hidden md:block">
                          <StatusPill pill={OFFER_STATUS[offer.status]} />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {rows.length === 0 && (
                <p className="px-3.5 py-6 text-[13px] text-muted-foreground">
                  Ninguna oferta en este filtro.
                </p>
              )}
            </div>
            {selected && <OfferDetail offer={selected} offers={list} />}
          </div>
        </>
      )}
    </>
  )
}

function OfferDetail({
  offer,
  offers,
}: {
  offer: AdminShipmentOffer
  offers: AdminShipmentOffer[]
}) {
  const { shipment, photos } = useOffers()
  const status = OFFER_STATUS[offer.status]
  const delta = suggestedDelta(offer.priceArs, shipment.suggestedPriceArs)
  const rank = priceRank(offer, offers)
  const byPrice = offers.map((o) => o.priceArs).sort((a, b) => a - b)
  const total = receivedLabel(offer, shipment.status)
  const pickup = offerPickup(offer, shipment)
  return (
    <aside
      aria-label="Detalle de la oferta"
      className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 border-t bg-surface-sub px-5 py-[18px] md:border-t-0 md:border-l"
    >
      <div className="flex items-center gap-3">
        <UserAvatar
          name={offer.carrierName ?? "Sin nombre"}
          photoUrl={photos[offer.carrierId] ?? null}
          size={40}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Link
            href={`/users/${offer.carrierId}`}
            className="truncate text-[15px] font-semibold hover:underline"
          >
            {offer.carrierName ?? "Sin nombre"}
          </Link>
          <span className="text-xs text-muted-foreground">
            {offer.carrierRatingAtOffer !== null
              ? `★ ${formatRating(offer.carrierRatingAtOffer)} al momento de ofertar`
              : "Sin calificaciones al momento de ofertar"}
          </span>
        </div>
        <StatusPill pill={status} />
      </div>
      <p className="-mt-1.5 text-[12.5px] text-muted-foreground">
        {status.help}
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={sectionLabel}>Cómo se compara</h3>
          <DeltaPill delta={delta} />
        </div>
        <div className="rounded-lg border bg-card px-3.5 py-3">
          <div className="flex items-end gap-2.5">
            <span className="text-[26px] leading-none font-semibold">
              {rank}.ª
            </span>
            <span className="pb-0.5 text-[13px] text-fg2">
              {rankLabel(offer, offers)}
            </span>
          </div>
          <div aria-hidden className="mt-3 flex gap-1">
            {byPrice.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  i + 1 === rank
                    ? "bg-foreground"
                    : i + 1 < rank
                      ? "bg-lime"
                      : "bg-muted"
                )}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11.5px] text-muted-foreground">
            <span>más barata {formatArs(byPrice[0]!)}</span>
            <span>más cara {formatArs(byPrice.at(-1)!)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={sectionLabel}>Cómo se reparte</h3>
          {/* El precio queda fijo al ofertar; el reparto se calcula al leer con la tasa vigente. */}
          <span className="text-[11px] text-muted-foreground">
            con la comisión vigente
          </span>
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between gap-3 bg-muted px-3.5 py-3">
            <span className="text-[13px] text-fg2">El emisor paga</span>
            <span className="text-[15px] font-semibold tabular-nums">
              {formatArs(offer.priceArs)}
            </span>
          </div>
          <div className="flex flex-col gap-2.5 px-3.5 py-3 text-[13px] text-muted-foreground">
            <div className="flex justify-between gap-3">
              <span>{commissionLabel(offer)}</span>
              <span className="tabular-nums">
                − {formatArs(offer.commissionArs)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Procesamiento del pago (estimado)</span>
              <span className="tabular-nums">
                − {formatArs(offer.mpFeeEstimateArs)}
              </span>
            </div>
          </div>
          <div
            className={cn(
              "flex items-center justify-between gap-3 px-3.5 py-3",
              total.highlight ? "bg-lime" : "bg-muted"
            )}
          >
            {/* Sobre lima el texto va en tinta fija, como en mobile: `text-foreground` es blanco en oscuro. */}
            <span
              className={cn(
                "text-[11px] font-medium tracking-[0.04em] uppercase",
                total.highlight ? "text-[#0a0a0b]/65" : "text-fg2"
              )}
            >
              {total.label}
            </span>
            <span
              className={cn(
                "text-2xl font-semibold tabular-nums",
                total.highlight && "text-[#0a0a0b]"
              )}
            >
              {formatArs(offer.receivedEstimateArs)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col">
        <h3 className={cn(sectionLabel, "mb-1")}>Horarios</h3>
        <Fact label="Retiro pedido">{requestedPickup(shipment)}</Fact>
        <Fact label="Retiro propuesto">
          {pickup.when}
          <br />
          <span className="text-xs text-muted-foreground">{pickup.note}</span>
        </Fact>
        <Fact label="Entrega estimada">{offerDelivery(offer)}</Fact>
      </div>

      {offer.message && (
        <div className="flex flex-col gap-1.5">
          <h3 className={sectionLabel}>Mensaje del transportista</h3>
          <blockquote className="rounded-lg border bg-card px-3 py-2.5 text-[13px] text-fg2">
            {offer.message}
          </blockquote>
        </div>
      )}

      <div className="flex flex-col">
        <h3 className={cn(sectionLabel, "mb-1")}>Recorrido de la oferta</h3>
        {offerLife(offer).map((step) => (
          <Fact key={step.label} label={step.label} muted>
            {step.value}
          </Fact>
        ))}
      </div>

      <CopyId id={offer.id} />
    </aside>
  )
}

function Fact({
  label,
  muted = false,
  children,
}: {
  label: string
  muted?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed py-[7px] text-[13px] last:border-b-0">
      <span className={cn(muted && "text-muted-foreground")}>{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <div className="mt-auto flex items-center gap-2 text-xs text-muted-foreground">
      <span>ID</span>
      <span className="truncate font-mono">{id}</span>
      <button
        type="button"
        aria-label={copied ? "ID copiado" : "Copiar ID de la oferta"}
        onClick={() => {
          void navigator.clipboard?.writeText(id).then(() => {
            setCopied(true)
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 1500)
          })
        }}
        className="flex size-7 flex-none items-center justify-center rounded-md outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? (
          <Check aria-hidden className="size-3.5" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )}
      </button>
    </div>
  )
}

/** Lo que muestra el evento de aceptación de la línea de tiempo en lugar del motivo crudo. */
export function AcceptedOfferNote({
  offerId,
  tags,
}: {
  offerId: string
  tags: string[]
}) {
  const { shipment, offers } = useOffers()
  const list = offers.data ?? []
  const offer = list.find((o) => o.id === offerId)
  const delta = offer
    ? suggestedDelta(offer.priceArs, shipment.suggestedPriceArs)
    : null
  return (
    <div className="mt-1.5 flex flex-col gap-2 rounded-md border bg-surface-sub px-3 py-2.5">
      {offer && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px] font-semibold tabular-nums">
            {formatArs(offer.priceArs)}
          </span>
          <DeltaPill delta={delta} />
          {list.length > 1 && (
            <span className="text-xs text-muted-foreground">
              {priceRank(offer, list)}.ª más barata de {list.length}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex h-[22px] items-center rounded-full bg-muted px-[9px] text-xs font-medium text-fg2"
          >
            {tag}
          </span>
        ))}
      </div>
      {/* Sin la oferta (bloque caído o no encontrada) el modal no tendría qué mostrar. */}
      {offer && (
        <ViewOffersButton offerId={offerId}>
          {list.length > 1 ? `Ver las ${list.length} ofertas` : "Ver la oferta"}
        </ViewOffersButton>
      )}
    </div>
  )
}
