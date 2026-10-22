"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import {
  boundsOf,
  decodePolyline,
  remainingRoute,
  timeLabel,
  type LatLng,
} from "@/lib/shipments/tracking/geometry"
import {
  TILE_ATTRIBUTION,
  tileUrl,
  type MapTheme,
} from "@/lib/shipments/tracking/tiles"
import type { AdminShipmentTracking } from "@/lib/shipments/tracking/types"

const DONE_COLOR = "#2B6BFF"
const DEFAULT_CENTER: LatLng = [-31.4167, -64.1833]

interface Layers {
  done: L.Polyline
  todo: L.Polyline
  origin: L.Marker
  destination: L.Marker
  courier: L.Marker | null
}

/** Pin con disco, ícono de texto y etiqueta opcional; se arma con DOM para no interpolar HTML. */
function pin(kind: "origin" | "destination" | "courier", label?: string, alert = false) {
  const root = document.createElement("div")
  root.className = "mv-track-pin"
  const disc = document.createElement("span")
  if (kind === "courier") {
    disc.className = "mv-track-courier"
    disc.dataset.alert = String(alert)
  } else {
    disc.style.cssText = `width:22px;height:22px;border-radius:${kind === "origin" ? "6px" : "999px"};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);background:${kind === "origin" ? "#0A0A0B" : DONE_COLOR}`
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
    const planned = t.plannedRoute ? decodePolyline(t.plannedRoute.polyline) : []
    const trace: LatLng[] = t.trace.map((p) => [p.lat, p.lng])
    const last: LatLng | null = t.lastPosition
      ? [t.lastPosition.lat, t.lastPosition.lng]
      : null
    const live = t.state === "live"
    const done = live && last ? [...trace, last] : trace
    // Faltante: lo que resta de la ruta planificada. Cerrado con traza: no se dibuja (la traza es la evidencia).
    const todo =
      live || t.state === "not_started" || (t.state === "closed" && trace.length === 0)
        ? remainingRoute(planned, live ? last : null)
        : []

    const originAt: LatLng = [t.origin.lat, t.origin.lng]
    const destinationAt: LatLng = [t.destination.lat, t.destination.lng]
    const layers = (layersRef.current ??= {
      done: L.polyline([], {
        color: DONE_COLOR,
        weight: 4,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map),
      todo: L.polyline([], {
        className: "mv-track-todo",
        color: theme === "dark" ? "#FFFFFF" : "#0A0A0B",
        weight: 3,
        opacity: 0.5,
        dashArray: "2 8",
        lineCap: "round",
      }).addTo(map),
      origin: L.marker(originAt, { zIndexOffset: 400 }).addTo(map),
      destination: L.marker(destinationAt, { zIndexOffset: 400 }).addTo(map),
      courier: null,
    })
    layers.done.setLatLngs(done)
    layers.todo.setLatLngs(todo)
    layers.todo.setStyle({ color: theme === "dark" ? "#FFFFFF" : "#0A0A0B" })
    layers.origin.setLatLng(originAt).setIcon(pin("origin", t.origin.label))
    layers.destination
      .setLatLng(destinationAt)
      .setIcon(pin("destination", t.destination.label))

    if (live && last) {
      const alert = t.signalLost || t.delayed
      const icon = pin("courier", courierLabel(t), alert)
      if (layers.courier) layers.courier.setLatLng(last).setIcon(icon)
      else layers.courier = L.marker(last, { icon, zIndexOffset: 800 }).addTo(map)
    } else if (layers.courier) {
      layers.courier.remove()
      layers.courier = null
    }

    if (fittedFor.current !== t.shipmentId) {
      const bounds = boundsOf(planned, trace, [originAt, destinationAt])
      if (bounds) map.fitBounds(bounds, { padding: [56, 56], maxZoom: 15 })
      fittedFor.current = t.shipmentId
    } else if (follow && live && last) map.panTo(last, { animate: false })
  }, [tracking, theme, follow])

  useEffect(() => {
    const t = tracking
    if (follow && t.state === "live" && t.lastPosition)
      mapRef.current?.panTo([t.lastPosition.lat, t.lastPosition.lng], {
        animate: false,
      })
    // Solo al activar el toggle; las actualizaciones las cubre el efecto de dibujo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow])

  return (
    <div
      ref={containerRef}
      className="mv-track-map absolute inset-0"
      role="img"
      aria-label={`Mapa del envío de ${tracking.origin.label} a ${tracking.destination.label}`}
    />
  )
}
