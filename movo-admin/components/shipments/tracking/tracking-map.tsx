"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import {
  boundsOf,
  decodePolyline,
  remainingRouteProgress,
  timeLabel,
  type LatLng,
} from "@/lib/shipments/tracking/geometry"
import {
  TILE_ATTRIBUTION,
  tileUrl,
  type MapTheme,
} from "@/lib/shipments/tracking/tiles"
import type { AdminShipmentTracking } from "@/lib/shipments/tracking/types"

const DEFAULT_CENTER: LatLng = [-31.4167, -64.1833]

interface Layers {
  done: L.Polyline
  todo: L.Polyline
  origin: L.Marker
  destination: L.Marker
  courier: L.Marker | null
  originLabel: string
  destinationLabel: string
  courierIconKey: string | null
}

/** Pin con disco, ícono de texto y etiqueta opcional; se arma con DOM para no interpolar HTML. */
function pin(
  kind: "origin" | "destination" | "courier",
  label?: string,
  alert = false
) {
  const root = document.createElement("div")
  root.className = "mv-track-pin"
  const disc = document.createElement("span")
  if (kind === "courier") {
    disc.className = "mv-track-courier"
    disc.dataset.alert = String(alert)
  } else {
    disc.className =
      kind === "origin" ? "mv-track-origin" : "mv-track-destination"
  }
  root.append(disc)
  if (label) {
    const text = document.createElement("span")
    text.className = "mv-track-label"
    text.textContent = label
    root.append(text)
  }
  return L.divIcon({
    html: root,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

export function courierLabel(t: AdminShipmentTracking): string {
  if (t.signalLost) return `sin señal · ${timeLabel(t.lastPingAt)}`
  if (t.delayed) return "demorado"
  return ""
}

interface Props {
  tracking: AdminShipmentTracking
  follow: boolean
  theme: MapTheme
}

export default function TrackingMap({ tracking, follow, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tilesRef = useRef<L.TileLayer | null>(null)
  const layersRef = useRef<Layers | null>(null)
  const fittedFor = useRef<string | null>(null)
  const routeProgress = useRef<{
    shipmentId: string
    polyline: string
    segment: number
  } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const map = L.map(el, {
      zoomControl: false,
      // La rueda hace scroll de la página (el mapa vive en un detalle largo); se acerca con +/− o doble clic.
      scrollWheelZoom: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    })
    map.attributionControl.setPrefix(false)
    L.control.zoom({ position: "bottomright" }).addTo(map)
    map.setView(DEFAULT_CENTER, 12)
    mapRef.current = map
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(el)
    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      tilesRef.current = null
      layersRef.current = null
      fittedFor.current = null
      routeProgress.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    tilesRef.current?.remove()
    tilesRef.current = null
    const url = tileUrl(theme, process.env.NEXT_PUBLIC_ESRI_API_KEY)
    if (url)
      tilesRef.current = L.tileLayer(url, {
        attribution: TILE_ATTRIBUTION,
        maxZoom: 16,
      }).addTo(map)
  }, [theme])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const t = tracking
    const planned = t.plannedRoute
      ? decodePolyline(t.plannedRoute.polyline)
      : []
    const trace: LatLng[] = t.trace.map((p) => [p.lat, p.lng])
    const last: LatLng | null = t.lastPosition
      ? [t.lastPosition.lat, t.lastPosition.lng]
      : null
    const live = t.state === "live"
    const done = live && last ? [...trace, last] : trace
    const previous = routeProgress.current
    const startSegment =
      previous?.shipmentId === t.shipmentId &&
      previous.polyline === t.plannedRoute?.polyline
        ? previous.segment
        : 0
    const pending = live
      ? remainingRouteProgress(planned, last, startSegment)
      : null
    const todo = pending?.points ?? []
    if (pending)
      routeProgress.current = {
        shipmentId: t.shipmentId,
        polyline: t.plannedRoute?.polyline ?? "",
        segment: pending.segment,
      }

    const originAt: LatLng = [t.origin.lat, t.origin.lng]
    const destinationAt: LatLng = [t.destination.lat, t.destination.lng]
    const layers = (layersRef.current ??= {
      done: L.polyline([], {
        className: "mv-track-done",
        weight: 4,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map),
      todo: L.polyline([], {
        className: "mv-track-todo",
        weight: 3,
        dashArray: "2 8",
        lineCap: "round",
      }).addTo(map),
      origin: L.marker(originAt, {
        icon: pin("origin", t.origin.label),
        zIndexOffset: 400,
      }).addTo(map),
      destination: L.marker(destinationAt, {
        icon: pin("destination", t.destination.label),
        zIndexOffset: 400,
      }).addTo(map),
      courier: null,
      originLabel: t.origin.label,
      destinationLabel: t.destination.label,
      courierIconKey: null,
    })
    layers.done.setLatLngs(done)
    layers.todo.setLatLngs(todo)
    layers.origin.setLatLng(originAt)
    layers.destination.setLatLng(destinationAt)
    if (layers.originLabel !== t.origin.label) {
      layers.origin.setIcon(pin("origin", t.origin.label))
      layers.originLabel = t.origin.label
    }
    if (layers.destinationLabel !== t.destination.label) {
      layers.destination.setIcon(pin("destination", t.destination.label))
      layers.destinationLabel = t.destination.label
    }

    if (live && last) {
      const alert = t.signalLost || t.delayed
      const label = courierLabel(t)
      const iconKey = `${label}:${alert}`
      if (layers.courier) {
        layers.courier.setLatLng(last)
        if (layers.courierIconKey !== iconKey)
          layers.courier.setIcon(pin("courier", label, alert))
      } else
        layers.courier = L.marker(last, {
          icon: pin("courier", label, alert),
          zIndexOffset: 800,
        }).addTo(map)
      layers.courierIconKey = iconKey
    } else if (layers.courier) {
      layers.courier.remove()
      layers.courier = null
      layers.courierIconKey = null
    }

    if (fittedFor.current !== t.shipmentId) {
      const bounds = boundsOf(planned, trace, [originAt, destinationAt])
      if (bounds) map.fitBounds(bounds, { padding: [56, 56], maxZoom: 15 })
      fittedFor.current = t.shipmentId
    } else if (follow && live && last) map.panTo(last, { animate: false })
  }, [tracking, follow])

  return (
    <div
      ref={containerRef}
      className="mv-track-map absolute inset-0"
      role="img"
      aria-label={`Mapa del envío de ${tracking.origin.label} a ${tracking.destination.label}`}
    />
  )
}
