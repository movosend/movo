"use client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import {
  CalendarDays,
  MapPin,
  RotateCw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react"
import {
  ADMIN_SHIPMENT_GROUP_STATUSES,
  ADMIN_SHIPMENT_GROUPS,
  type AdminShipmentPage,
} from "@movo/shared/src/types/admin-shipments"
import { SHIPMENT_STATUS } from "@/lib/users/format"
import {
  formatClock,
  TAB_LABEL,
  type ShipmentTab,
} from "@/lib/shipments/format"
import {
  listHref,
  listQuery,
  withFilter,
  type ListState,
} from "@/lib/shipments/params"
import { cn } from "@/lib/utils"

type Counts = Pick<AdminShipmentPage, "counts" | "statusCounts" | "alertCounts">

const TABS: ShipmentTab[] = ["all", ...ADMIN_SHIPMENT_GROUPS]
const chip =
  "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * Pestañas por grupo, chips por estado, búsqueda, ciudad, fechas y "Solo con alerta". Todo vive en
 * la URL: cada cambio la reemplaza y la página del servidor vuelve a pedir la lista.
 */
export function ShipmentFilters({
  state,
  counts,
  resultLabel,
  loadedAt,
}: {
  state: ListState
  /** `null` si la lista no cargó: las pestañas se ven igual, sin números. */
  counts: Counts | null
  resultLabel: string
  loadedAt: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  // El último estado pedido, no el del render: el timer de la búsqueda o un blur de la ciudad
  // pueden navegar justo después de otro filtro, y cada cambio se suma al anterior en vez de pisarlo.
  const latest = useRef(state)
  const stateKey = listQuery(state)
  useEffect(() => {
    latest.current = state
    // `state` es un objeto nuevo en cada render del servidor; alcanza con su querystring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey])
  const go = (patch: Partial<ListState>) => {
    latest.current = withFilter(latest.current, patch)
    const href = listHref(latest.current)
    start(() => router.replace(href, { scroll: false }))
  }

  // Búsqueda con debounce: escribir no navega en cada tecla.
  const [q, setQ] = useState(state.q)
  const lastSent = useRef(state.q)
  useEffect(() => {
    if (q.trim() === lastSent.current) return
    const t = setTimeout(() => {
      lastSent.current = q.trim()
      go({ q: q.trim() })
    }, 350)
    return () => clearTimeout(t)
    // `go` lee el estado de `latest`; solo importa el texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const [city, setCity] = useState(state.city)
  const sentCity = useRef(state.city)
  const applyCity = () => {
    if (city.trim() === latest.current.city) return
    sentCity.current = city.trim()
    go({ city: city.trim() })
  }

  // La URL cambió sin remontar (sidebar, atrás/adelante): los inputs vuelven a mostrarla. Lo que
  // mandó este mismo componente no se toca, así no se borra lo que se siguió escribiendo.
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

  const subs =
    state.tab === "all" ? [] : ADMIN_SHIPMENT_GROUP_STATUSES[state.tab]
  const tabCount = (tab: ShipmentTab) => counts?.counts[tab]
  // Los conteos de alerta son por pestaña: con un chip de estado elegido el número no aplica.
  const alertCount = state.status ? undefined : counts?.alertCounts[state.tab]

  return (
    <div className="flex min-w-0 flex-col gap-3" aria-busy={pending}>
      <div
        role="tablist"
        aria-label="Grupos de envíos"
        className="flex min-w-0 overflow-x-auto border-b"
      >
        {TABS.map((tab) => {
          const on = state.tab === tab
          const tabClass = cn(
            "-mb-px flex h-10 flex-none items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            on
              ? "border-foreground text-foreground"
              : "border-transparent text-fg2"
          )
          // Las disputas tienen su propia bandeja (MOVO-343): la pestaña lleva ahí en vez de filtrar el listado.
          if (tab === "disputes")
            return (
              <Link
                key={tab}
                href="/disputes"
                role="tab"
                aria-selected={false}
                className={tabClass}
              >
                {TAB_LABEL[tab]}
                {tabCount(tab) !== undefined && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {tabCount(tab)}
                  </span>
                )}
              </Link>
            )
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => go({ tab, status: null })}
              className={cn(
                "-mb-px flex h-10 flex-none items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                on
                  ? "border-foreground text-foreground"
                  : "border-transparent text-fg2"
              )}
            >
              {TAB_LABEL[tab]}
              {tabCount(tab) !== undefined && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {tabCount(tab)}
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
            placeholder="Buscá por código, nombre o dirección"
            aria-label="Buscar envíos"
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
            aria-label="Último cambio desde"
            className="bg-transparent text-[13px] text-foreground outline-none"
          />
          <span aria-hidden>–</span>
          <input
            type="date"
            value={state.to}
            min={state.from || undefined}
            onChange={(e) => go({ to: e.target.value })}
            aria-label="Último cambio hasta"
            className="bg-transparent text-[13px] text-foreground outline-none"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {subs.length > 1 && (
          <>
            {[null, ...subs].map((status) => {
              const on = state.status === status
              const n = status
                ? counts?.statusCounts[status]
                : tabCount(state.tab)
              return (
                <button
                  key={status ?? "all"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => go({ status })}
                  className={cn(
                    chip,
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "border-border-strong bg-card text-fg2 hover:border-fg2"
                  )}
                >
                  {status ? SHIPMENT_STATUS[status].label : "Todos"}
                  {n !== undefined && (
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        on ? "text-background/70" : "text-muted-foreground"
                      )}
                    >
                      {n}
                    </span>
                  )}
                </button>
              )
            })}
            <span aria-hidden className="mx-1 h-5 w-px bg-border-strong" />
          </>
        )}
        <button
          type="button"
          aria-pressed={state.alert}
          onClick={() => go({ alert: !state.alert })}
          className={cn(
            chip,
            state.alert
              ? "border-warn-fg bg-warn-soft text-warn-fg"
              : "border-border-strong bg-card text-fg2 hover:border-fg2"
          )}
        >
          <TriangleAlert aria-hidden className="size-3.5" />
          Solo con alerta
          {alertCount !== undefined && (
            <span className="text-xs tabular-nums">{alertCount}</span>
          )}
        </button>
        <span className="ml-auto flex items-center gap-3 text-[13px] text-muted-foreground">
          <span aria-live="polite">{resultLabel}</span>
          <ReloadButton loadedAt={loadedAt} />
        </span>
      </div>
    </div>
  )
}

/** Recarga manual (sin refresco automático) con la hora de la última carga. */
export function ReloadButton({ loadedAt }: { loadedAt: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className="flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-card px-2.5 text-[13px] font-medium text-fg2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      <RotateCw
        aria-hidden
        className={cn("size-3.5", pending && "animate-spin")}
      />
      <span>
        Actualizado{" "}
        <span className="font-mono tabular-nums">{formatClock(loadedAt)}</span>
      </span>
    </button>
  )
}
