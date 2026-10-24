"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import { useTheme } from "next-themes"
import { Crosshair, Radio, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { trackingMessage } from "@/lib/shipments/tracking/copy"
import type { PollStatus } from "@/lib/shipments/tracking/poller"
import type { AdminShipmentTracking } from "@/lib/shipments/tracking/types"
import { TrackingMetrics } from "./tracking-metrics"
import { useTracking } from "./use-tracking"

// Leaflet toca `window`: solo se carga en el navegador.
const TrackingMap = dynamic(() => import("./tracking-map"), {
  ssr: false,
  loading: () => <Skeleton className="absolute inset-0 rounded-none" />,
})

const MAP_HEIGHT = "h-[320px] sm:h-[400px]"

export function LiveIndicator({ status }: { status: PollStatus }) {
  const label =
    status === "live"
      ? "En vivo"
      : status === "paused"
        ? "En pausa"
        : status === "reconnecting"
          ? "Reconectando…"
          : status === "error"
            ? "Error de seguimiento"
            : "Conectando…"
  return (
    <span
      role="status"
      className="flex h-8 items-center gap-2 rounded-full border border-border bg-[var(--glass)] px-3 text-xs font-medium text-foreground backdrop-blur-xl"
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${status === "live" ? "mv-pulse-dot" : status === "reconnecting" ? "bg-dot-warning" : "bg-muted-foreground"}`}
      />
      {label}
    </span>
  )
}

function MessageStrip({ tracking }: { tracking: AdminShipmentTracking }) {
  const { title, body } = trackingMessage(tracking)
  const purged = tracking.state === "closed" && !tracking.traceAvailable
  return (
    <div className="flex items-center gap-3 px-[18px] py-3.5 text-[13px] text-muted-foreground">
      <span
        aria-hidden="true"
        className="flex size-8 flex-none items-center justify-center rounded-lg bg-muted"
      >
        <Radio className="size-4" />
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-foreground">{title}</span>
        <span>{body}</span>
        {purged && <span>La traza GPS ya fue purgada.</span>}
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="flex h-8 items-center gap-2 rounded-full border border-border bg-[var(--glass)] px-3 text-xs font-medium text-foreground backdrop-blur-xl">
      <span
        aria-hidden="true"
        className="size-2.5 rounded-[3px] bg-foreground"
      />
      Retiro
      <span
        aria-hidden="true"
        className="h-0.5 w-4 rounded bg-[var(--track-done)]"
      />
      Recorrido
      <span
        aria-hidden="true"
        className="size-2.5 rounded-full border-2 border-white bg-[var(--track-done)]"
      />
      Entrega
    </div>
  )
}

/** Cuerpo del panel con datos ya cargados; separado del hook para probarlo sin red ni timers. */
export function TrackingView({
  tracking,
  status,
  receivedAt,
}: {
  tracking: AdminShipmentTracking
  status: PollStatus
  receivedAt?: number
}) {
  const { resolvedTheme } = useTheme()
  const [follow, setFollow] = useState(false)
  const live = tracking.state === "live"
  const showMap =
    live || (tracking.state === "closed" && tracking.trace.length > 0)

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-card">
      {showMap && (
        <div className={`relative isolate z-0 ${MAP_HEIGHT}`}>
          <TrackingMap
            tracking={tracking}
            follow={follow}
            theme={resolvedTheme === "dark" ? "dark" : "light"}
          />
          <div className="absolute top-3 left-3 z-[500] flex flex-wrap gap-2">
            <Legend />
            {live && <LiveIndicator status={status} />}
          </div>
          {live && (
            <button
              type="button"
              aria-pressed={follow}
              onClick={() => setFollow((value) => !value)}
              className={`absolute top-3 right-3 z-[500] flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium backdrop-blur-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${follow ? "border-foreground bg-foreground text-background" : "border-border bg-[var(--glass)] text-foreground"}`}
            >
              <Crosshair className="size-3.5" aria-hidden="true" />
              Seguir al transportista
            </button>
          )}
        </div>
      )}
      {live ? (
        <TrackingMetrics tracking={tracking} receivedAt={receivedAt} />
      ) : (
        <div className={showMap ? "border-t border-border" : ""}>
          <MessageStrip tracking={tracking} />
        </div>
      )}
    </div>
  )
}

/** Seguimiento de un envío dentro del detalle (MOVO-328). */
export function ShipmentTrackingMap({ shipmentId }: { shipmentId: string }) {
  const { data, receivedAt, status, refresh } = useTracking(shipmentId)

  if (!data && status === "connecting")
    return (
      <SkeletonGroup
        label="Cargando seguimiento…"
        className="overflow-hidden rounded-[10px] border border-border bg-card"
      >
        <Skeleton className={`${MAP_HEIGHT} w-full rounded-none`} />
      </SkeletonGroup>
    )

  if (!data)
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-[18px] py-4 text-[13px]"
      >
        <span className="text-muted-foreground">
          No pudimos cargar el seguimiento.
        </span>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw aria-hidden="true" />
          Reintentar
        </Button>
      </div>
    )

  if (status === "error")
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-[18px] py-4 text-[13px]"
      >
        <span>
          No pudimos cargar el seguimiento. Revisá el envío o tu sesión.
        </span>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw aria-hidden="true" />
          Reintentar
        </Button>
      </div>
    )

  return (
    <TrackingView
      tracking={data}
      status={status}
      receivedAt={receivedAt ?? undefined}
    />
  )
}
