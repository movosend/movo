import type Redis from "ioredis";
import { ADMIN_TRACKING_POLL_INTERVAL_SECONDS, AdminShipmentTracking, AdminTrackingPoint, ShipmentStatus } from "@movo/shared";
import type { Shipment as ShipmentRow } from "../../generated/prisma/client";
import { adminTrackingState, averageSpeedKmh, capTrace, trackingMetrics } from "../../domain/admin-tracking";
import type { PositionRepository } from "../../repositories/position-repository";
import type { ShipmentRepository, ShipmentTrackingContext } from "../../repositories/shipment-repository";
import { lastKnownPositionKey } from "../../services/position-service";
import { decodePolyline } from "../../utils/polyline-decode";
import type { PlannedRouteStore } from "./planned-route-store";

export interface AdminTrackingServiceDeps {
  shipmentRepository: Pick<ShipmentRepository, "findTrackingContext">;
  positionRepository: Pick<PositionRepository, "listCustodyTrace">;
  redis: Pick<Redis, "hgetall">;
  routeStore: PlannedRouteStore;
  signalLostSeconds: number;
  now?: () => Date;
}

type LastPosition = NonNullable<AdminShipmentTracking["lastPosition"]> & { receivedAt: string };

/**
 * MOVO-327: seguimiento de un envío para el mapa del panel (polling, sin WS del panel todavía). Reusa la
 * traza de custodia de MOVO-270 y la última posición del viaje en Redis (MOVO-251); las métricas no existían
 * para el mapa de emisor/receptor (MOVO-204 solo lee la última posición), así que se calculan acá.
 */
export function createAdminTrackingService(deps: AdminTrackingServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function lastKnown(tripId: string): Promise<LastPosition | null> {
    const raw = await deps.redis.hgetall(lastKnownPositionKey(tripId));
    if (!raw?.lat) return null;
    // Sin `recordedAt` válido no se puede medir la antigüedad: se usa la hora del dispositivo, y si tampoco
    // sirve el punto se descarta (cae a la traza persistida) en vez de esconder la falta de señal.
    const receivedAt = [raw.recordedAt, raw.capturedAt].find((v) => v && !Number.isNaN(Date.parse(v)));
    if (!receivedAt) return null;
    return {
      lat: Number(raw.lat),
      lng: Number(raw.lng),
      accuracyM: raw.accuracyM ? Number(raw.accuracyM) : null,
      capturedAt: raw.capturedAt,
      receivedAt,
    };
  }

  return {
    async get(row: ShipmentRow): Promise<AdminShipmentTracking> {
      const serverTime = now();
      const status = row.status as ShipmentStatus;
      const { state, reason } = adminTrackingState(status);
      const origin = {
        lat: row.pickupLat.toNumber(),
        lng: row.pickupLng.toNumber(),
        label: row.pickupCity ?? row.pickupAddress,
      };
      const destination = {
        lat: row.deliveryLat.toNumber(),
        lng: row.deliveryLng.toNumber(),
        label: row.deliveryCity ?? row.deliveryAddress,
      };

      // El contexto se resuelve una sola vez por tick; la ruta solo se pide (y factura) con viaje asignado.
      const context: ShipmentTrackingContext | null =
        state === "no_carrier" ? null : await deps.shipmentRepository.findTrackingContext(row.id);
      const trip = context?.trip ?? null;

      const withTrace = state === "live" || state === "closed";
      const [route, positions, redisPosition] = await Promise.all([
        trip ? deps.routeStore.get(row.id, origin, destination) : null,
        withTrace ? deps.positionRepository.listCustodyTrace(row.id) : [],
        state === "live" && trip ? lastKnown(trip.id) : null,
      ]);

      const fullTrace: AdminTrackingPoint[] = positions.map((p) => ({
        lat: p.lat,
        lng: p.lng,
        capturedAt: p.capturedAt.toISOString(),
      }));
      const { points: trace, truncated } = capTrace(fullTrace);

      const base = {
        shipmentId: row.id,
        shipmentStatus: status,
        state,
        reason,
        origin,
        destination,
        plannedRoute: route
          ? { polyline: route.polyline, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds }
          : null,
        trace,
        traceTruncated: truncated,
        traceAvailable: trace.length > 0,
        delayed: status === ShipmentStatus.IN_TRANSIT && row.transitAnomalyFlaggedAt !== null,
        serverTime: serverTime.toISOString(),
        pollIntervalSeconds: ADMIN_TRACKING_POLL_INTERVAL_SECONDS,
      };

      if (state !== "live") {
        return { ...base, lastPosition: null, lastPingAt: null, signalLost: false, metrics: null };
      }

      // Redis guarda cada ping (no solo los persistidos cada 45 s); si venció, el último punto de la traza.
      const lastStored = positions[positions.length - 1];
      const last: LastPosition | null =
        redisPosition ??
        (lastStored
          ? {
              lat: lastStored.lat,
              lng: lastStored.lng,
              accuracyM: lastStored.accuracyM,
              capturedAt: lastStored.capturedAt.toISOString(),
              receivedAt: lastStored.recordedAt.toISOString(),
            }
          : null);

      // La hora del servidor al recibirlo, no la del dispositivo: un reloj adelantado no esconde la falta de señal.
      const signalLost = !last || serverTime.getTime() - Date.parse(last.receivedAt) > deps.signalLostSeconds * 1000;
      const lastPosition = last
        ? { lat: last.lat, lng: last.lng, accuracyM: last.accuracyM, capturedAt: last.capturedAt }
        : null;

      return {
        ...base,
        lastPosition,
        lastPingAt: last?.receivedAt ?? null,
        signalLost,
        metrics: last
          ? trackingMetrics({
              position: last,
              origin,
              destination,
              route: route
                ? { path: decodePolyline(route.polyline), distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds }
                : null,
              avgSpeedKmh: averageSpeedKmh(fullTrace, new Date(last.capturedAt)),
              signalLost,
              now: serverTime,
            })
          : null,
      };
    },
  };
}
