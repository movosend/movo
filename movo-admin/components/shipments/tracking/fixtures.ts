import type { AdminShipmentTracking } from "@/lib/shipments/tracking/types"

/** "_p~iF~ps|U_ulLnnqC_mqNvxq`@": ejemplo de la documentación de Google (3 puntos). */
export const POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"

export function trackingFixture(
  over: Partial<AdminShipmentTracking> = {}
): AdminShipmentTracking {
  return {
    shipmentId: "s1",
    shipmentStatus: "in_transit",
    state: "live",
    reason: null,
    origin: { lat: 38.5, lng: -120.2, label: "Nueva Córdoba" },
    destination: { lat: 43.252, lng: -126.453, label: "Cerro de las Rosas" },
    plannedRoute: {
      polyline: POLYLINE,
      distanceMeters: 9000,
      durationSeconds: 900,
    },
    trace: [
      { lat: 38.5, lng: -120.2, capturedAt: "2026-10-22T11:58:00Z" },
      { lat: 39, lng: -120.5, capturedAt: "2026-10-22T11:59:00Z" },
    ],
    traceTruncated: false,
    traceAvailable: true,
    lastPosition: {
      lat: 39,
      lng: -120.5,
      accuracyM: 8,
      capturedAt: "2026-10-22T11:59:57Z",
    },
    lastPingAt: "2026-10-22T11:59:57Z",
    signalLost: false,
    delayed: false,
    metrics: {
      avgSpeedKmh5m: 23.4,
      remainingMeters: 4230,
      progressPct: 53,
      etaAt: "2026-10-22T12:20:00Z",
    },
    serverTime: "2026-10-22T12:00:00Z",
    pollIntervalSeconds: 15,
    pickupWindow: "09:00–11:00",
    carrierFirstName: "Diego",
    ...over,
  }
}
