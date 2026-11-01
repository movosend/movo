"use client"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { CalendarDays, MapPin, Search, X } from "lucide-react"
import { DisputeReason, DisputeStatus } from "@movo/shared/src/types/dispute"
import type { AdminDisputePage } from "@movo/shared/src/types/admin-disputes"
import { DISPUTE_REASON_LABEL, DISPUTE_STATUS_TAB } from "@/lib/disputes/format"
import {
  disputeListHref,
  disputeQuery,
  withDisputeFilter,
  type DisputeListState,
} from "@/lib/disputes/params"
import { ReloadButton } from "@/components/shipments/shipment-filters"
import { cn } from "@/lib/utils"

const TABS = [
  DisputeStatus.OPEN,
  DisputeStatus.RESOLVING,
  DisputeStatus.RESOLVED,
] as const

/**
 * Pestañas de estado, búsqueda por partes o código, motivo, "Ciudad del retiro" y fechas de apertura.
 * Todo vive en la URL: cada cambio la reemplaza y la página del servidor vuelve a pedir la lista. La
 * ciudad se aplica al salir del campo o con Enter, igual que en el listado de envíos.
 */
export function DisputeFilters({
  state,
  counts,
  resultLabel,
  loadedAt,
}: {
  state: DisputeListState
  /** `null` si la lista no cargó: las pestañas se ven igual, sin números. */
  counts: AdminDisputePage["statusCounts"] | null
  resultLabel: string
  loadedAt: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  // El último estado pedido, no el del render (ver `ShipmentFilters`): cada cambio se suma al anterior.
  const latest = useRef(state)
  const stateKey = disputeQuery(state)
  useEffect(() => {
    latest.current = state
    // `state` es un objeto nuevo en cada render del servidor; alcanza con su querystring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey])
  const go = (patch: Partial<DisputeListState>) => {
    latest.current = withDisputeFilter(latest.current, patch)
    const href = disputeListHref(latest.current)
    start(() => router.replace(href, { scroll: false }))
  }

  const [q, setQ] = useState(state.q)
  const lastSent = useRef(state.q)
  useEffect(() => {
    if (q.trim() === lastSent.current) return
    const t = setTimeout(() => {
      lastSent.current = q.trim()
      go({ q: q.trim() })
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const [city, setCity] = useState(state.city)
  const sentCity = useRef(state.city)
  const applyCity = () => {
    if (city.trim() === latest.current.city) return
    sentCity.current = city.trim()
    go({ city: city.trim() })
  }
  useEffect(() => {
    if (state.q === lastSent.current) return
    lastSent.current = state.q
    setQ(state.q)
  }, [state.q])
  useEffect(() => {
    if (state.city === sentCity.current) return
    sentCity.current = state.city
    setCity(state.city)
  }, [state.city])

  return (
    <div className="flex min-w-0 flex-col gap-3" aria-busy={pending}>
      <div
        role="tablist"
        aria-label="Estado de la disputa"
        className="flex min-w-0 overflow-x-auto border-b"
      >
        {TABS.map((tab) => {
          const on = state.status === tab
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => go({ status: tab })}
              className={cn(
                "-mb-px flex h-10 flex-none items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                on
                  ? "border-foreground text-foreground"
                  : "border-transparent text-fg2"
              )}
            >
              {DISPUTE_STATUS_TAB[tab]}
              {counts && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {counts[tab]}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 max-w-[420px] min-w-[220px] flex-1 items-center gap-2.5 rounded-lg border border-border-strong bg-card px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <Search aria-hidden className="size-4 flex-none" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscá por código o nombre de una parte"
            aria-label="Buscar disputas"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button
              type="button"
              aria-label="Borrar búsqueda"
              onClick={() => setQ("")}
              className="flex size-6 items-center justify-center rounded-md hover:bg-muted"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          )}
        </label>
        <select
          value={state.reason ?? ""}
          onChange={(e) =>
            go({ reason: (e.target.value || null) as DisputeReason | null })
          }
          aria-label="Motivo"
          className="h-9 rounded-lg border border-border-strong bg-card px-3 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Todos los motivos</option>
          {Object.values(DisputeReason).map((reason) => (
            <option key={reason} value={reason}>
              {DISPUTE_REASON_LABEL[reason]}
            </option>
          ))}
        </select>
        <label className="flex h-9 w-[180px] items-center gap-2 rounded-lg border border-border-strong bg-card px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <MapPin aria-hidden className="size-4 flex-none" />
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onBlur={applyCity}
            onKeyDown={(e) => e.key === "Enter" && applyCity()}
            placeholder="Ciudad del retiro"
            aria-label="Ciudad del retiro"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-card px-3 text-muted-foreground">
          <CalendarDays aria-hidden className="size-4 flex-none" />
          <input
            type="date"
            value={state.from}
            max={state.to || undefined}
            onChange={(e) => go({ from: e.target.value })}
            aria-label="Abierta desde"
            className="bg-transparent text-[13px] text-foreground outline-none"
          />
          <span aria-hidden>–</span>
          <input
            type="date"
            value={state.to}
            min={state.from || undefined}
            onChange={(e) => go({ to: e.target.value })}
            aria-label="Abierta hasta"
            className="bg-transparent text-[13px] text-foreground outline-none"
          />
        </div>
        <span className="ml-auto flex items-center gap-3 text-[13px] text-muted-foreground">
          <span aria-live="polite">{resultLabel}</span>
          <ReloadButton loadedAt={loadedAt} />
        </span>
      </div>
    </div>
  )
}
