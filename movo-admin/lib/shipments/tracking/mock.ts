import "server-only"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { mockEnabled } from "@/lib/users/mock"
import { distanceMeters, type LatLng } from "./geometry"
import type { AdminShipmentTracking, TrackingState } from "./types"

export { mockEnabled }

/** Ids de los envíos de prueba (modo `MOVO_ADMIN_MOCK=1`): uno por estado del mapa. */
export const MOCK_TRACKING_IDS = {
  live: "00000000-0000-4000-8000-000000000001",
  signalLost: "00000000-0000-4000-8000-000000000002",
  awaitingPickup: "00000000-0000-4000-8000-000000000003",
  unfunded: "00000000-0000-4000-8000-000000000004",
  delivered: "00000000-0000-4000-8000-000000000005",
  disputed: "00000000-0000-4000-8000-000000000006",
  noCarrier: "00000000-0000-4000-8000-000000000007",
  purged: "00000000-0000-4000-8000-000000000008",
} as const

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Recorrido Nueva Córdoba → Cerro de las Rosas, con curvas para que se vea como una calle. */
const ROUTE: LatLng[] = [
  [-31.4262, -64.1884],
  [-31.4235, -64.1881],
  [-31.4208, -64.1893],
  [-31.4183, -64.1902],
  [-31.4151, -64.1898],
  [-31.4122, -64.1921],
  [-31.4093, -64.1957],
  [-31.4061, -64.1986],
  [-31.4032, -64.2018],
  [-31.4004, -64.2049],
  [-31.3978, -64.2071],
  [-31.3951, -64.2102],
]

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let out = ""
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  return out + String.fromCharCode(v + 63)
}

function encodePolyline(points: LatLng[]): string {
  let prevLat = 0
  let prevLng = 0
  return points
    .map(([lat, lng]) => {
      const la = Math.round(lat * 1e5)
      const ln = Math.round(lng * 1e5)
      const chunk = encodeValue(la - prevLat) + encodeValue(ln - prevLng)
      prevLat = la
      prevLng = ln
      return chunk
    })
    .join("")
}

const lengthMeters = ROUTE.slice(1).reduce(
  (sum, point, i) => sum + distanceMeters(ROUTE[i], point),
  0
)

/** Punto a `fraction` (0..1) del recorrido, interpolando entre vértices. */
function pointAt(fraction: number): LatLng {
  const target = Math.min(1, Math.max(0, fraction)) * lengthMeters
  let walked = 0
  for (let i = 1; i < ROUTE.length; i++) {
    const seg = distanceMeters(ROUTE[i - 1], ROUTE[i])
    if (walked + seg >= target) {
      const t = seg === 0 ? 0 : (target - walked) / seg
      return [
        ROUTE[i - 1][0] + (ROUTE[i][0] - ROUTE[i - 1][0]) * t,
        ROUTE[i - 1][1] + (ROUTE[i][1] - ROUTE[i - 1][1]) * t,
      ]
    }
    walked += seg
  }
  return ROUTE[ROUTE.length - 1]
}

const ORIGIN = { lat: ROUTE[0][0], lng: ROUTE[0][1], label: "Nueva Córdoba" }
const DESTINATION = {
  lat: ROUTE[ROUTE.length - 1][0],
  lng: ROUTE[ROUTE.length - 1][1],
  label: "Cerro de las Rosas",
}

const SPEED_MPS = 6.5
const POLL_SECONDS = 15

/** Traza cada 45 s hasta `fraction` del recorrido, con el último punto en `fraction`. */
function traceUntil(fraction: number, endMs: number) {
  const steps = Math.max(
    2,
    Math.round((fraction * lengthMeters) / (SPEED_MPS * 45))
  )
  return Array.from({ length: steps + 1 }, (_, i) => {
    const f = (fraction * i) / steps
    const [lat, lng] = pointAt(f)
    return {
      lat,
      lng,
      capturedAt: new Date(endMs - (steps - i) * 45_000).toISOString(),
    }
  })
}

function build(
  id: string,
  state: TrackingState,
  shipmentStatus: string,
  extra: Partial<AdminShipmentTracking> = {}
): AdminShipmentTracking {
  const now = Date.now()
  return {
    shipmentId: id,
    shipmentStatus,
    state,
    reason: null,
    origin: ORIGIN,
    destination: DESTINATION,
    plannedRoute: {
      polyline: encodePolyline(ROUTE),
      distanceMeters: Math.round(lengthMeters),
      durationSeconds: Math.round(lengthMeters / SPEED_MPS),
    },
    trace: [],
    traceTruncated: false,
    traceAvailable: true,
    lastPosition: null,
    lastPingAt: null,
    signalLost: false,
    delayed: false,
    metrics: null,
    serverTime: new Date(now).toISOString(),
    pollIntervalSeconds: POLL_SECONDS,
    pickupWindow: "09:00–11:00",
    carrierFirstName: "Diego",
    ...extra,
  }
}

function liveShipment(id: string, lost: boolean): AdminShipmentTracking {
  const now = Date.now()
  // Con señal avanza ~6,5 m/s y vuelve a empezar al llegar al final; sin señal queda quieto a 55 %.
  const fraction = lost
    ? 0.55
    : (((now / 1000) * SPEED_MPS * 0.05) % lengthMeters) / lengthMeters
  const [lat, lng] = pointAt(fraction)
  const pingAt = lost ? now - 14 * 60_000 : now - 3_000
  const remaining = (1 - fraction) * lengthMeters
  return build(id, "live", "in_transit", {
    trace: traceUntil(fraction, pingAt),
    lastPosition: {
      lat,
      lng,
      accuracyM: 8,
      capturedAt: new Date(pingAt).toISOString(),
    },
    lastPingAt: new Date(pingAt).toISOString(),
    signalLost: lost,
    delayed: lost,
    metrics: {
      avgSpeedKmh5m: lost ? null : Math.round(SPEED_MPS * 3.6),
      remainingMeters: Math.round(remaining),
      progressPct: Math.round(fraction * 100),
      etaAt: lost
        ? null
        : new Date(now + (remaining / SPEED_MPS) * 1000).toISOString(),
    },
  })
}

const SCENARIOS: Record<string, () => AdminShipmentTracking> = {
  [MOCK_TRACKING_IDS.live]: () => liveShipment(MOCK_TRACKING_IDS.live, false),
  [MOCK_TRACKING_IDS.signalLost]: () =>
    liveShipment(MOCK_TRACKING_IDS.signalLost, true),
  [MOCK_TRACKING_IDS.awaitingPickup]: () =>
    build(MOCK_TRACKING_IDS.awaitingPickup, "not_started", "assigned", {
      reason: "awaiting_pickup",
    }),
  [MOCK_TRACKING_IDS.unfunded]: () =>
    build(MOCK_TRACKING_IDS.unfunded, "not_started", "assigned_unfunded", {
      reason: "unfunded",
    }),
  [MOCK_TRACKING_IDS.delivered]: () =>
    build(MOCK_TRACKING_IDS.delivered, "closed", "delivered", {
      reason: "delivered",
      trace: traceUntil(1, Date.now() - 3_600_000),
    }),
  [MOCK_TRACKING_IDS.disputed]: () =>
    build(MOCK_TRACKING_IDS.disputed, "closed", "disputed", {
      reason: "disputed",
      trace: traceUntil(1, Date.now() - 86_400_000),
    }),
  [MOCK_TRACKING_IDS.noCarrier]: () =>
    build(MOCK_TRACKING_IDS.noCarrier, "no_carrier", "published", {
      reason: "no_carrier",
      plannedRoute: null,
      carrierFirstName: null,
    }),
  [MOCK_TRACKING_IDS.purged]: () =>
    build(MOCK_TRACKING_IDS.purged, "closed", "completed", {
      reason: "completed",
      traceAvailable: false,
    }),
}

const latency = () => Number(process.env.MOVO_ADMIN_MOCK_LATENCY_MS ?? 350)

export async function mockTracking(id: string): Promise<AdminShipmentTracking> {
  await sleep(latency() * 0.5)
  if (process.env.MOVO_ADMIN_MOCK_FAIL?.split(",").includes("tracking"))
    throw new ApiError(502, "INTERNAL_ERROR", "Servicio no disponible.")
  const scenario = SCENARIOS[id]
  if (!scenario) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.")
  return scenario()
}
