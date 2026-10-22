import {
  agoLabel,
  kmLabel,
  timeLabel,
} from "@/lib/shipments/tracking/geometry"
import type { AdminShipmentTracking } from "@/lib/shipments/tracking/types"

interface Metric {
  label: string
  value: string
  sub: string
  warn?: boolean
}

/** Las cuatro tarjetas del prototipo: Último ping, Velocidad, Falta y Llegada (MOVO-328 AC3). */
export function trackingMetrics(t: AdminShipmentTracking): Metric[] {
  const m = t.metrics
  const lost = t.signalLost
  return [
    {
      label: "Último ping",
      value: agoLabel(t.lastPingAt, t.serverTime),
      sub: lost ? "sin posiciones nuevas" : "GPS del transportista",
      warn: lost,
    },
    {
      label: "Velocidad",
      value:
        lost || m?.avgSpeedKmh5m == null ? "—" : `${Math.round(m.avgSpeedKmh5m)} km/h`,
      sub: "promedio últimos 5 min",
    },
    {
      label: "Falta",
      value: kmLabel(m?.remainingMeters ?? null),
      sub: m?.progressPct == null ? "—" : `${Math.round(m.progressPct)}% del recorrido`,
    },
    {
      label: "Llegada",
      value: lost || !m?.etaAt ? "—" : `~${timeLabel(m.etaAt)}`,
      sub: t.pickupWindow ? `ventana ${t.pickupWindow}` : "—",
    },
  ]
}

export function TrackingMetrics({ tracking }: { tracking: AdminShipmentTracking }) {
  return (
    <dl className="grid grid-cols-2 border-t border-border md:grid-cols-4">
      {trackingMetrics(tracking).map((metric, i) => (
        <div
          key={metric.label}
          className={`flex flex-col gap-1 px-4 py-3.5 md:px-[18px] ${i % 2 === 0 ? "border-r" : ""} ${i < 2 ? "border-b md:border-b-0" : ""} ${i < 3 ? "md:border-r" : "md:border-r-0"} border-border`}
        >
          <dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {metric.label}
          </dt>
          <dd
            className={`font-mono text-lg font-semibold tracking-tight ${metric.warn ? "text-warn-fg" : "text-foreground"}`}
          >
            {metric.value}
          </dd>
          <dd className="text-xs text-muted-foreground">{metric.sub}</dd>
        </div>
      ))}
    </dl>
  )
}
