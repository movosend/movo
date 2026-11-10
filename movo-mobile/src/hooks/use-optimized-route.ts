import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { getCurrentLocation, watchForegroundLocation } from "../lib/location";
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
 *
 * Feedback de TestFlight build 18 ("cada vez que entro dice calculando la mejor ruta" y "no se
 * actualiza mi posición"): la última ruta de cada viaje queda en memoria y se muestra al volver a
 * entrar mientras se refresca en silencio (la pantalla de carga queda para la primera vez), y con la
 * pantalla enfocada la posición del transportista sigue al GPS (`watchForegroundLocation`), no solo
 * a cada pedido de la ruta.
 */
type LatLng = { lat: number; lng: number };

/** Última ruta por viaje (`""` = la ruta del día sin viaje), para no volver a la pantalla de carga. */
const lastRouteByTrip = new Map<string, { route: CarrierRoute; location: LatLng }>();

/** Solo para tests: el cache es del módulo y sobrevive entre casos. */
export function clearOptimizedRouteCache(): void {
  lastRouteByTrip.clear();
}

export function useOptimizedRoute(tripId?: string): UseOptimizedRouteResult {
  const cacheKey = tripId ?? "";
  const cached = lastRouteByTrip.get(cacheKey);
  const [route, setRoute] = useState<CarrierRoute | null>(cached?.route ?? null);
  const [carrierLocation, setCarrierLocation] = useState<LatLng | null>(cached?.location ?? null);
  const [isLoading, setIsLoading] = useState<boolean>(!cached);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [gpsPermissionDenied, setGpsPermissionDenied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef<number>(0);

  const fetchRoute = useCallback(async (isRefresh = false) => {
    const requestId = ++requestSeqRef.current;
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const locResult = await getCurrentLocation();
      if (requestId !== requestSeqRef.current) return;
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
      if (requestId !== requestSeqRef.current) return;
      setRoute(result);
      lastRouteByTrip.set(tripId ?? "", { route: result, location: coords });
    } catch (err: unknown) {
      if (requestId !== requestSeqRef.current) return;
      // En un refresh en background, preservar la ruta existente para no dejar la pantalla vacía
      if (!isRefresh) setRoute(null);
      setError(friendlyErrorMessage(err, "No pudimos calcular tu ruta optimizada. Intentá de nuevo."));
    } finally {
      if (requestId === requestSeqRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [tripId]);

  // AC7: Refrescar la ruta automáticamente al ganar foco (ej: al volver de completar una parada).
  // isRefresh=true: el primer render ya inicia con isLoading=true; los refrescos por foco son silenciosos.
  useFocusEffect(
    useCallback(() => {
      void fetchRoute(true);
      let stopWatching: (() => void) | null = null;
      let cancelled = false;
      void watchForegroundLocation((coords) => setCarrierLocation(coords)).then((stop) => {
        if (cancelled) stop();
        else stopWatching = stop;
      });
      return () => {
        // Invalidar petición en vuelo si la pantalla pierde foco
        requestSeqRef.current++;
        cancelled = true;
        stopWatching?.();
      };
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
