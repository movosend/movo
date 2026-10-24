/**
 * Contrato provisorio de `GET /admin/shipments/:id/tracking` (MOVO-327). Es la forma propuesta en
 * el comentario de ese ticket; cuando `AdminShipmentTracking` exista en `@movo/shared` se borra
 * este archivo y se importa de ahí.
 */
export type TrackingState = "not_started" | "live" | "closed" | "no_carrier"

export type TrackingReason =
  | "awaiting_pickup"
  | "unfunded"
  | "delivered"
  | "completed"
  | "disputed"
  | "no_carrier"

export interface TrackingPlace {
  lat: number
  lng: number
  label: string
}

export interface TrackingPoint {
  lat: number
  lng: number
  capturedAt: string
}

export interface TrackingMetrics {
  avgSpeedKmh5m: number | null
  remainingMeters: number | null
  progressPct: number | null
  etaAt: string | null
}

export interface AdminShipmentTracking {
  shipmentId: string
  shipmentStatus: string
  state: TrackingState
  reason: TrackingReason | null
  origin: TrackingPlace
  destination: TrackingPlace
  plannedRoute: {
    polyline: string
    distanceMeters: number
    durationSeconds: number
  } | null
  trace: TrackingPoint[]
  traceTruncated: boolean
  traceAvailable: boolean
  lastPosition: {
    lat: number
    lng: number
    accuracyM: number | null
    capturedAt: string
  } | null
  lastPingAt: string | null
  signalLost: boolean
  delayed: boolean
  metrics: TrackingMetrics | null
  serverTime: string
  pollIntervalSeconds: number
  /** Ventana de retiro ("09:00–11:00") para la tarjeta "Llegada"; la trae el detalle si el tracking no. */
  pickupWindow?: string | null
  carrierFirstName?: string | null
}
