import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { getCurrentLocation } from "../lib/location";
import { shipmentsClient, type CarrierRoute } from "../api/shipments-client";
import { friendlyErrorMessage } from "../lib/error-messages";

export interface UseOptimizedRouteResult {
  route: CarrierRoute | null;
  carrierLocation: { lat: number; lng: number } | null;
  isLoading: boolean;
  isRefreshing: boolean;
  gpsPermissionDenied: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook para la gestión de la ruta optimizada multi-parada del transportista (MOVO-207).
 *
 * AC8: Obtiene la ubicación actual del dispositivo vía GPS en foreground. Si el permiso
 * fue denegado o el GPS está inactivo, marca `gpsPermissionDenied: true` sin mandar
 * coordenadas ficticias.
 *
 * AC7: Se recálcula automáticamente cuando la pantalla gana foco (`useFocusEffect`),
 * garantizando que si el transportista completó o canceló una parada en un wizard,
 * al regresar a la vista de ruta las paradas restantes se actualicen de inmediato.
 */
export function useOptimizedRoute(tripId?: string): UseOptimizedRouteResult {
  const [route, setRoute] = useState<CarrierRoute | null>(null);
  const [carrierLocation, setCarrierLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [gpsPermissionDenied, setGpsPermissionDenied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRoute = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const locResult = await getCurrentLocation();
      if (!locResult.granted) {
        setGpsPermissionDenied(true);
        setRoute(null);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      setGpsPermissionDenied(false);
      const coords = { lat: locResult.lat, lng: locResult.lng };
      setCarrierLocation(coords);

      const result = tripId
        ? await shipmentsClient.getMyRoute(coords, tripId)
        : await shipmentsClient.getMyRoute(coords);
      setRoute(result);
    } catch (err: unknown) {
      setError(friendlyErrorMessage(err, "No pudimos calcular tu ruta optimizada. Intentá de nuevo."));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // AC7: Refrescar la ruta automáticamente al ganar foco (ej: al volver de completar una parada)
  useFocusEffect(
    useCallback(() => {
      void fetchRoute();
    }, [fetchRoute])
  );

  const refetch = useCallback(async () => {
    await fetchRoute(true);
  }, [fetchRoute]);

  return {
    route,
    carrierLocation,
    isLoading,
    isRefreshing,
    gpsPermissionDenied,
    error,
    refetch,
  };
}
