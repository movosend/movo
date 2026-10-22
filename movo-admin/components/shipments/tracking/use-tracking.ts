"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { fetchTracking } from "@/lib/shipments/tracking/client"
import {
  TrackingPoller,
  type PollStatus,
} from "@/lib/shipments/tracking/poller"
import type { AdminShipmentTracking } from "@/lib/shipments/tracking/types"

/** Seguimiento de un envío con actualización automática (MOVO-328 AC5). */
export function useTracking(shipmentId: string) {
  // Se guarda con el id al que pertenece: al cambiar de envío se descarta solo, sin setState en el efecto.
  const [loaded, setLoaded] = useState<{
    id: string
    data: AdminShipmentTracking
  } | null>(null)
  const [polled, setPolled] = useState<{ id: string; status: PollStatus } | null>(
    null
  )
  const data = loaded?.id === shipmentId ? loaded.data : null
  const status: PollStatus = polled?.id === shipmentId ? polled.status : "connecting"
  const pollerRef = useRef<TrackingPoller | null>(null)

  useEffect(() => {
    const poller = new TrackingPoller({
      fetchTracking: (signal) => fetchTracking(shipmentId, signal),
      onData: (next) => setLoaded({ id: shipmentId, data: next }),
      onStatus: (next) => setPolled({ id: shipmentId, status: next }),
      isVisible: () => document.visibilityState !== "hidden",
    })
    pollerRef.current = poller
    const onVisibility = () => poller.visibilityChanged()
    document.addEventListener("visibilitychange", onVisibility)
    poller.start()
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      poller.stop()
      pollerRef.current = null
    }
  }, [shipmentId])

  const refresh = useCallback(() => pollerRef.current?.refresh(), [])
  return { data, status, refresh }
}
