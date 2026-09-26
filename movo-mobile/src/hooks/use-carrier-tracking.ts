import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { shipmentsClient, type ActiveShipmentSummary } from "../api/shipments-client";
import { tripsClient, TripStatus } from "../api/trips-client";
import { locationService, type TrackingStatus } from "../location/location-service";
import { useAuthStore } from "../store/auth-store";

export interface UseCarrierTrackingOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

export interface UseCarrierTrackingResult extends TrackingStatus {
  inTransitCount: number;
  inTransitShipments?: ActiveShipmentSummary[];
  checkPermission: () => Promise<boolean>;
  requestPermission: () => Promise<boolean>;
  checkBackgroundPermission: () => Promise<boolean>;
  requestBackgroundPermission: () => Promise<boolean>;
  flushQueue: () => Promise<void>;
  refetchTransporting?: () => Promise<unknown>;
}

export interface UseCarrierTrackingCoordinatorResult {
  trackableShipments: ActiveShipmentSummary[];
  trackableCount: number;
  inTransitShipments: ActiveShipmentSummary[];
  inTransitCount: number;
  refetchTransporting: () => Promise<unknown>;
}

/**
 * Coordinador central de ciclo de vida del tracking del transportista (MOVO-203 / MOVO-242).
 *
 * Se monta una sola vez a nivel de sesión en el layout raíz (`app/_layout.tsx`),
 * siguiendo el mismo patrón de `usePushNotifications` y `useDeviceKeyBootstrap`.
 * Coordina la consulta de envíos en tránsito (`GET /shipments/transporting`),
 * viajes activos (`GET /trips`), el chequeo de permisos y la sincronización con el singleton `locationService`.
 */
export function useCarrierTrackingCoordinator(
  options?: UseCarrierTrackingOptions
): UseCarrierTrackingCoordinatorResult {
  const isEnabled = options?.enabled ?? true;
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const [isTracking, setIsTracking] = useState(() => locationService.getStatus().isTracking);

  useEffect(() => {
    return locationService.subscribe((status) => {
      setIsTracking(status.isTracking);
    });
  }, []);

  // Consultar envíos activos donde el usuario autenticado es el transportista
  const calculatedInterval = isTracking ? 15_000 : 30_000;
  const pollInterval =
    options?.refetchInterval !== undefined ? options.refetchInterval : calculatedInterval;

  const { data: transportingShipments, refetch: refetchTransporting } = useQuery({
    queryKey: ["shipments", "transporting"],
    queryFn: () => shipmentsClient.getTransporting(),
    enabled: isAuthenticated && isEnabled,
    refetchInterval: pollInterval,
  });

  // Consultar viajes del transportista para asociar el tripId activo (MOVO-242)
  const { data: myTrips } = useQuery({
    queryKey: ["trips", "mine", "tracking"],
    queryFn: () => tripsClient.list({ page: 1, limit: 10 }),
    enabled: isAuthenticated && isEnabled,
    refetchInterval: pollInterval,
    retry: false,
  });

  const activeTrip = myTrips?.items?.find(
    (t) => t.status === TripStatus.ACTIVE || (t.status as string) === "active"
  );
  const activeTripId = activeTrip?.id ?? null;
  const activeTripStatus = activeTrip?.status ?? null;

  // Filtrar envíos elegibles para tracking: assigned e in_transit (MOVO-242 / MOVO-251 TRACKABLE_SHIPMENT_STATUSES)
  // Excluye assigned_unfunded ya que requiere hold confirmado de fondos antes de trackeo
  const trackableShipments = (transportingShipments ?? []).filter(
    (s) => s.status === "assigned" || s.status === "in_transit"
  );
  const trackableIds = trackableShipments.map((s) => s.id);
  const trackableKey = trackableIds.sort().join(",");

  const inTransitShipments = (transportingShipments ?? []).filter(
    (s) => s.status === "in_transit"
  );

  // Chequeo inicial de permisos al autenticarse
  useEffect(() => {
    if (isAuthenticated && isEnabled) {
      void locationService.checkForegroundPermission();
      void locationService.checkBackgroundPermission();
    }
  }, [isAuthenticated, isEnabled]);

  // Sincronización con el ciclo de vida de los envíos trackeables y el viaje activo (AC7, AC11)
  useEffect(() => {
    if (!isAuthenticated || !isEnabled) {
      void locationService.stopTracking();
      return;
    }

    if (activeTripId || activeTripStatus) {
      void locationService.updateActiveShipments(trackableIds, activeTripId, activeTripStatus);
    } else {
      void locationService.updateActiveShipments(trackableIds);
    }
  }, [isAuthenticated, isEnabled, trackableKey, activeTripId, activeTripStatus]);

  return {
    trackableShipments,
    trackableCount: trackableShipments.length,
    inTransitShipments,
    inTransitCount: inTransitShipments.length,
    refetchTransporting,
  };
}

/**
 * Hook de consumo reactivo para componentes visuales (MOVO-203, AC8; MOVO-242).
 *
 * Lee directamente del singleton `locationService`, compartiendo estado
 * de tracking y permisos en toda la app sin duplicar peticiones de red ni listeners.
 */
export function useCarrierTracking(): UseCarrierTrackingResult {
  const [status, setStatus] = useState<TrackingStatus>(() => locationService.getStatus());

  useEffect(() => {
    return locationService.subscribe(setStatus);
  }, []);

  return {
    ...status,
    permissionGranted: status.permissionGranted,
    inTransitCount: status.activeShipmentIds.length,
    checkPermission: () => locationService.checkForegroundPermission(),
    requestPermission: () => locationService.requestForegroundPermission(),
    checkBackgroundPermission: () => locationService.checkBackgroundPermission(),
    requestBackgroundPermission: () => locationService.requestBackgroundPermission(),
    flushQueue: () => locationService.flushQueue(),
  };
}
