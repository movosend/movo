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

/** Proyecta la posición sobre el tramo más cercano a partir del último avance conocido. */
export function remainingRouteProgress(
  planned: LatLng[],
  from: LatLng | null,
  startSegment = 0
): { points: LatLng[]; segment: number } {
  if (planned.length === 0) return { points: [], segment: 0 }
  if (!from || planned.length === 1) return { points: planned, segment: 0 }
  const first = Math.min(Math.max(0, startSegment), planned.length - 2)
  let nearest = first
  let best = Infinity
  let projected: LatLng = planned[first]
  for (let i = first; i < planned.length - 1; i++) {
    const a = planned[i]
    const b = planned[i + 1]
    // Coordenadas locales en metros: ambos ejes usan la misma escala para comparar tramos.
    const scale = Math.cos(toRad(from[0]))
    const dx = (b[1] - a[1]) * scale
    const dy = b[0] - a[0]
    const length2 = dx * dx + dy * dy
    const fraction =
      length2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((from[1] - a[1]) * scale * dx + (from[0] - a[0]) * dy) / length2
            )
          )
    const point: LatLng = [
      a[0] + (b[0] - a[0]) * fraction,
      a[1] + (b[1] - a[1]) * fraction,
    ]
    const d = distanceMeters(from, point)
    if (d < best) {
      best = d
      nearest = i
      projected = point
    }
  }
  return {
    points: [from, projected, ...planned.slice(nearest + 1)],
    segment: nearest,
  }
}

export function remainingRoute(
  planned: LatLng[],
  from: LatLng | null
): LatLng[] {
  return remainingRouteProgress(planned, from).points
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

/** "hace 3 s" / "hace 14 min" / "hace 2 h", medido contra la hora estimada del servidor. */
export function agoLabel(
  iso: string | null,
  serverTime: string | number
): string {
  if (!iso) return "—"
  const seconds = Math.max(
    0,
    Math.round(
      ((typeof serverTime === "number" ? serverTime : Date.parse(serverTime)) -
        Date.parse(iso)) /
        1000
    )
  )
  if (seconds < 60) return `hace ${seconds} s`
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`
  return `hace ${Math.floor(seconds / 3600)} h`
}

export function timeLabel(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString("es-AR", {
    timeZone: "America/Argentina/Cordoba",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

export function kmLabel(meters: number | null): string {
  if (meters === null) return "—"
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`
}
