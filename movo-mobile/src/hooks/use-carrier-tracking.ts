import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { shipmentsClient, type ActiveShipmentSummary } from "../api/shipments-client";
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
  flushQueue: () => Promise<void>;
  refetchTransporting?: () => Promise<unknown>;
}

export interface UseCarrierTrackingCoordinatorResult {
  inTransitShipments: ActiveShipmentSummary[];
  inTransitCount: number;
  refetchTransporting: () => Promise<unknown>;
}

/**
 * Coordinador central de ciclo de vida del tracking del transportista (MOVO-203).
 *
 * Se monta una sola vez a nivel de sesión en el layout raíz (`app/_layout.tsx`),
 * siguiendo el mismo patrón de `usePushNotifications` y `useDeviceKeyBootstrap`.
 * Coordina la consulta de envíos en tránsito (`GET /shipments/transporting`),
 * el chequeo de permisos y la sincronización con el singleton `locationService`.
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

  // Filtrar exclusivamente los envíos en tránsito (AC1)
  const inTransitShipments = (transportingShipments ?? []).filter(
    (s) => s.status === "in_transit"
  );
  const inTransitIds = inTransitShipments.map((s) => s.id);
  const inTransitKey = inTransitIds.sort().join(",");

  // Chequeo inicial de permisos al autenticarse
  useEffect(() => {
    if (isAuthenticated && isEnabled) {
      void locationService.checkPermission();
    }
  }, [isAuthenticated, isEnabled]);

  // Sincronización con el ciclo de vida de los envíos en in_transit
  useEffect(() => {
    if (!isAuthenticated || !isEnabled) {
      void locationService.stopTracking();
      return;
    }

    void locationService.updateActiveShipments(inTransitIds);
  }, [isAuthenticated, isEnabled, inTransitKey]);

  return {
    inTransitShipments,
    inTransitCount: inTransitShipments.length,
    refetchTransporting,
  };
}

/**
 * Hook de consumo reactivo para componentes visuales (MOVO-203, AC8).
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
    checkPermission: () => locationService.checkPermission(),
    requestPermission: () => locationService.requestPermission(),
    flushQueue: () => locationService.flushQueue(),
  };
}
