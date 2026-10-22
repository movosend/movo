export type LatLng = [number, number]

/** Polyline de Google (5 decimales). Portado de `movo-mobile/src/lib/polyline.ts`. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let shift = 0
      let result = 0
      let byte: number
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += delta
      else lng += delta
    }
    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Distancia en metros (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/**
 * Tramo de la ruta planificada que falta: desde el vértice más cercano a `from` hasta el final,
 * con `from` como primer punto para que la línea punteada salga del marcador.
 */
export function remainingRoute(planned: LatLng[], from: LatLng | null): LatLng[] {
  if (planned.length === 0) return []
  if (!from) return planned
  let nearest = 0
  let best = Infinity
  planned.forEach((point, i) => {
    const d = distanceMeters(point, from)
    if (d < best) {
      best = d
      nearest = i
    }
  })
  return [from, ...planned.slice(nearest + 1)]
}

export function boundsOf(...lists: LatLng[][]): [LatLng, LatLng] | null {
  const all = lists.flat()
  if (all.length === 0) return null
  const lats = all.map((p) => p[0])
  const lngs = all.map((p) => p[1])
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ]
}

/** "hace 3 s" / "hace 14 min" / "hace 2 h", medido contra la hora del servidor. */
export function agoLabel(iso: string | null, serverTime: string): string {
  if (!iso) return "—"
  const seconds = Math.max(
    0,
    Math.round((Date.parse(serverTime) - Date.parse(iso)) / 1000)
  )
  if (seconds < 60) return `hace ${seconds} s`
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`
  return `hace ${Math.floor(seconds / 3600)} h`
}

export function timeLabel(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

export function kmLabel(meters: number | null): string {
  if (meters === null) return "—"
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`
}
