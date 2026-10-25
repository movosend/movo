import {
  AdminTrackingMetrics,
  AdminTrackingPoint,
  AdminTrackingReason,
  AdminTrackingState,
  ShipmentStatus,
} from "@movo/shared";
import { haversineKm, progressAlongPath } from "./geo";

/**
 * MOVO-327: qué muestra el mapa del panel para cada estado. La posición solo se ve con `live` (el
 * transportista ya retiró y está en viaje, AC5); `closed` muestra la traza guardada sin posición actual.
 * `rejected_by_receiver` es previo a publicar (DD-027) y `cancelled` puede haber tenido transportista, por
 * eso va como `closed` (con la traza, si la hubo) y no como `no_carrier`.
 */
export function adminTrackingState(status: ShipmentStatus): { state: AdminTrackingState; reason: AdminTrackingReason | null } {
  switch (status) {
    case ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION:
    case ShipmentStatus.REJECTED_BY_RECEIVER:
    case ShipmentStatus.PUBLISHED:
      return { state: "no_carrier", reason: "no_carrier" };
    case ShipmentStatus.ASSIGNMENT_PENDING:
    case ShipmentStatus.ASSIGNED_UNFUNDED:
      return { state: "not_started", reason: "unfunded" };
    case ShipmentStatus.ASSIGNED:
      return { state: "not_started", reason: "awaiting_pickup" };
    case ShipmentStatus.IN_TRANSIT:
      return { state: "live", reason: null };
    case ShipmentStatus.DELIVERED:
      return { state: "closed", reason: "delivered" };
    case ShipmentStatus.COMPLETED:
      return { state: "closed", reason: "completed" };
    case ShipmentStatus.DISPUTED:
      return { state: "closed", reason: "disputed" };
    case ShipmentStatus.CANCELLED:
      return { state: "closed", reason: "cancelled" };
  }
}

/** Tope de puntos de la traza: a uno cada 45 s son ~6 h de viaje. */
export const ADMIN_TRACE_MAX_POINTS = 500;
/** Ventana de la velocidad promedio. */
export const AVG_SPEED_WINDOW_MS = 5 * 60 * 1000;

/** Submuestreo uniforme que conserva el primer y el último punto: el mapa no pierde el inicio del recorrido. */
export function capTrace<T>(points: T[], max = ADMIN_TRACE_MAX_POINTS): { points: T[]; truncated: boolean } {
  if (points.length <= max) return { points, truncated: false };
  const step = (points.length - 1) / (max - 1);
  return { points: Array.from({ length: max }, (_, i) => points[Math.round(i * step)]), truncated: true };
}

/**
 * Velocidad promedio de los puntos de los últimos 5 min antes de `until`: distancia recorrida entre ellos
 * sobre el tiempo entre el primero y el último. Aproximada (los puntos persistidos son uno cada 45 s);
 * `null` con menos de 2 puntos.
 */
export function averageSpeedKmh(trace: AdminTrackingPoint[], until: Date): number | null {
  const from = until.getTime() - AVG_SPEED_WINDOW_MS;
  const window = trace.filter((p) => {
    const t = Date.parse(p.capturedAt);
    return t >= from && t <= until.getTime();
  });
  if (window.length < 2) return null;
  const hours = (Date.parse(window[window.length - 1].capturedAt) - Date.parse(window[0].capturedAt)) / 3_600_000;
  if (hours <= 0) return null;
  let km = 0;
  for (let i = 1; i < window.length; i++) {
    km += haversineKm(window[i - 1].lat, window[i - 1].lng, window[i].lat, window[i].lng);
  }
  return round1(km / hours);
}

export interface TrackingMetricsInput {
  position: { lat: number; lng: number };
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  /** Ruta planificada decodificada, con su distancia y duración de Google. */
  route: { path: Array<{ lat: number; lng: number }>; distanceMeters: number; durationSeconds: number } | null;
  avgSpeedKmh: number | null;
  signalLost: boolean;
  now: Date;
}

/**
 * Km restantes, % y ETA. Con ruta: la posición se proyecta sobre la polyline y el resto se toma de la
 * distancia y la duración de Google en proporción, así un semáforo no dispara la ETA. Sin ruta (falló el
 * proveedor): línea recta a la entrega sobre la recta retiro→entrega, y ETA con la velocidad promedio.
 * Sin señal no hay velocidad ni ETA; km y % quedan sobre la última posición conocida.
 */
export function trackingMetrics(input: TrackingMetricsInput): AdminTrackingMetrics {
  const { position, origin, destination, route, signalLost, now } = input;
  const avgSpeedKmh = signalLost ? null : input.avgSpeedKmh;

  let progress: number | null = null;
  let remainingMeters: number | null = null;
  let remainingSeconds: number | null = null;

  const fraction = route ? progressAlongPath(position, route.path) : null;
  if (route && fraction !== null) {
    progress = fraction;
    remainingMeters = route.distanceMeters * (1 - fraction);
    remainingSeconds = route.durationSeconds * (1 - fraction);
  } else {
    const totalKm = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng);
    const leftKm = haversineKm(position.lat, position.lng, destination.lat, destination.lng);
    remainingMeters = leftKm * 1000;
    progress = totalKm > 0 ? Math.max(0, Math.min(1, 1 - leftKm / totalKm)) : null;
    remainingSeconds = avgSpeedKmh && avgSpeedKmh > 0 ? (leftKm / avgSpeedKmh) * 3600 : null;
  }

  return {
    avgSpeedKmh5m: avgSpeedKmh,
    remainingMeters: Math.round(remainingMeters),
    progressPct: progress === null ? null : round1(progress * 100),
    etaAt:
      signalLost || remainingSeconds === null ? null : new Date(now.getTime() + remainingSeconds * 1000).toISOString(),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
