"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "maplibre-gl/dist/maplibre-gl.css"
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet"
import type {
  DistanceBand,
  ReportCorridor,
} from "@movo/shared/src/types/admin-reports"
import { CORRIDOR_LOW_COMPLETION, corridorKey } from "@/lib/reports/catalog"
import {
  TILE_ATTRIBUTION,
  basemapStyleUrl,
  withArcgisToken,
  type MapTheme,
} from "@/lib/shipments/tracking/tiles"

/**
 * Arco entre dos ciudades: una curva cuadrática corrida hacia un costado, así dos corredores que
 * comparten ciudad no se tapan. Se calcula en grados (a esta escala alcanza).
 */
export function arcPoints(
  from: [number, number],
  to: [number, number],
  bend = 0.18,
  steps = 32
): [number, number][] {
  const [lat1, lng1] = from
  const [lat2, lng2] = to
  const cLat = (lat1 + lat2) / 2 + (lng2 - lng1) * bend
  const cLng = (lng1 + lng2) / 2 - (lat2 - lat1) * bend
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const u = 1 - t
    return [
      u * u * lat1 + 2 * u * t * cLat + t * t * lat2,
      u * u * lng1 + 2 * u * t * cLng + t * t * lng2,
    ]
  })
}

function cityIcon(name: string, active: boolean) {
  const root = document.createElement("div")
  root.className = "mv-corr-city"
  root.dataset.active = String(active)
  const dot = document.createElement("span")
  dot.className = "mv-corr-dot"
  const label = document.createElement("span")
  label.className = "mv-corr-label"
  label.textContent = name
  root.append(dot, label)
  return L.divIcon({
    html: root,
    className: "",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })
}

interface Props {
  corridors: ReportCorridor[]
  hover: string | null
  onHover: (key: string | null) => void
  band: DistanceBand | null
  theme: MapTheme
}

/** Mapa real (Leaflet + mapa base de ArcGIS, el mismo del seguimiento de envíos) con un arco por corredor. */
export default function CorridorMapCanvas({
  corridors,
  hover,
  onHover,
  band,
  theme,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tilesRef = useRef<L.MaplibreGL | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const fittedFor = useRef<string | null>(null)
  const hoverRef = useRef(onHover)
  useEffect(() => {
    hoverRef.current = onHover
  }, [onHover])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const map = L.map(el, {
      zoomControl: false,
      // La rueda hace scroll de la página; se acerca con +/− o doble clic.
      scrollWheelZoom: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    })
    map.attributionControl.setPrefix(false)
    L.control.zoom({ position: "bottomright" }).addTo(map)
    map.setView([-34, -63], 4)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(el)
    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      tilesRef.current = null
      layerRef.current = null
      fittedFor.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    tilesRef.current?.remove()
    tilesRef.current = null
    const apiKey = process.env.NEXT_PUBLIC_ESRI_API_KEY
    const style = basemapStyleUrl(theme, apiKey)
    if (style && apiKey) {
      const layer = maplibreGL({
        style,
        transformRequest: withArcgisToken(apiKey),
      })
      layer.options.attribution = TILE_ATTRIBUTION
      tilesRef.current = layer.addTo(map)
    }
  }, [theme])

  useEffect(() => {
    const map = mapRef.current
    const group = layerRef.current
    if (!map || !group) return
    group.clearLayers()
    const max = Math.max(1, ...corridors.map((c) => c.published))
    const focus = corridors.find((c) => corridorKey(c) === hover)
    // Los más usados arriba: se dibujan al final.
    for (const c of [...corridors].reverse()) {
      const key = corridorKey(c)
      const points = arcPoints(
        [c.originLat, c.originLng],
        [c.destinationLat, c.destinationLng]
      )
      const on = hover === key
      const dim = (band != null && band !== c.band) || (hover != null && !on)
      const low = (c.completionRate ?? 100) < CORRIDOR_LOW_COMPLETION
      const weight = 2 + (7 * c.published) / max
      if (on)
        L.polyline(points, {
          className: "mv-corr-casing",
          weight: weight + 4,
          lineCap: "round",
          interactive: false,
        }).addTo(group)
      L.polyline(points, {
        className: on
          ? "mv-corr-line mv-corr-on"
          : low
            ? "mv-corr-line mv-corr-low"
            : "mv-corr-line",
        weight,
        opacity: dim ? 0.18 : 0.9,
        lineCap: "round",
        interactive: false,
      }).addTo(group)
      // Zona de hover más ancha que la línea.
      L.polyline(points, { weight: 16, opacity: 0, lineCap: "round" })
        .on("mouseover", () => hoverRef.current(key))
        .on("mouseout", () => hoverRef.current(null))
        .addTo(group)
    }
    const cities = new Map<string, [number, number]>()
    for (const c of corridors) {
      cities.set(c.originCity, [c.originLat, c.originLng])
      cities.set(c.destinationCity, [c.destinationLat, c.destinationLng])
    }
    for (const [name, at] of cities) {
      const active =
        !!focus && (focus.originCity === name || focus.destinationCity === name)
      L.marker(at, {
        icon: cityIcon(name, active),
        interactive: false,
        keyboard: false,
        zIndexOffset: active ? 600 : 400,
      }).addTo(group)
    }
    // Se encuadra una vez por conjunto de corredores (cambiar el hover no mueve el mapa).
    const signature = [...cities.keys()].sort().join("|")
    if (cities.size && fittedFor.current !== signature) {
      map.fitBounds(L.latLngBounds([...cities.values()]), {
        padding: [36, 36],
        maxZoom: 8,
      })
      fittedFor.current = signature
    }
  }, [corridors, hover, band])

  return (
    <div
      ref={containerRef}
      className="mv-track-map absolute inset-0"
      role="img"
      aria-label="Mapa de los corredores con más envíos"
    />
  )
}
