import { useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { shipmentsClient, type ActiveShipmentSummary } from "../api/shipments-client";
import { locationService, type TrackingStatus } from "../location/location-service";
import { useAuthStore } from "../store/auth-store";

export interface UseCarrierTrackingOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

export interface UseCarrierTrackingResult extends TrackingStatus {
  permissionGranted: boolean | null;
  inTransitShipments: ActiveShipmentSummary[];
  inTransitCount: number;
  checkPermission: () => Promise<boolean>;
  requestPermission: () => Promise<boolean>;
  flushQueue: () => Promise<void>;
  refetchTransporting: () => Promise<unknown>;
}

/**
 * Hook de reactividad para el tracking del transportista (MOVO-203).
 *
 * Se activa automáticamente cuando el transportista tiene al menos un envío en `in_transit`
 * y se desactiva de inmediato cuando no queda ninguno (AC1, AC5 de MOVO-11, AC7).
 * Expone el estado de tracking, permisos, cola offline y métodos de control.
 */
export function useCarrierTracking(options?: UseCarrierTrackingOptions): UseCarrierTrackingResult {
  const isEnabled = options?.enabled ?? true;
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");

  const [status, setStatus] = useState<TrackingStatus>(() => locationService.getStatus());
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);

  // Consultar envíos activos donde el usuario autenticado es el transportista
  const calculatedInterval = status.isTracking ? 15_000 : 30_000;
  const pollInterval = options?.refetchInterval !== undefined ? options.refetchInterval : calculatedInterval;

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

  const checkPermission = useCallback(async (): Promise<boolean> => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      setPermissionGranted(perm.granted);
      return perm.granted;
    } catch {
      setPermissionGranted(false);
      return false;
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      setPermissionGranted(perm.granted);
      return perm.granted;
    } catch {
      setPermissionGranted(false);
      return false;
    }
  }, []);

  // Suscripción al singleton locationService
  useEffect(() => {
    const unsubscribe = locationService.subscribe(setStatus);
    void checkPermission();
    return unsubscribe;
  }, [checkPermission]);

  // Sincronización con el ciclo de vida de los envíos en in_transit
  useEffect(() => {
    if (!isAuthenticated || !isEnabled) {
      void locationService.stopTracking();
      return;
    }

    void locationService.updateActiveShipments(inTransitIds);
  }, [isAuthenticated, isEnabled, inTransitKey]);

  return {
    ...status,
    permissionGranted,
    inTransitShipments,
    inTransitCount: inTransitShipments.length,
    checkPermission,
    requestPermission,
    flushQueue: () => locationService.flushQueue(),
    refetchTransporting,
  };
}
