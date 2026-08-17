import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { shipmentsClient, type CreateShipmentInput, type ShipmentSummary } from "../api/shipments-client";

interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Últimos envíos propios para la sección "Actividad reciente" de Inicio (MOVO-83).
 * `limit: 3` — la home solo necesita una vista previa, no el listado completo (ese
 * queda para una pantalla de listado futura, fuera de este ticket).
 */
export function useRecentShipments() {
  return useQuery({
    queryKey: ["shipments", "mine", "recent"],
    queryFn: () => shipmentsClient.listMine({ page: 1, limit: 3 }),
  });
}

/** Crea un envío (wizard de MOVO-83). Invalida el preview de "Envíos recientes" de
 * Inicio para que el envío nuevo aparezca ahí sin esperar un refetch manual. */
export function useCreateShipment() {
  const queryClient = useQueryClient();
  return useMutation<ShipmentSummary, unknown, CreateShipmentInput>({
    mutationFn: (body) => shipmentsClient.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shipments", "mine", "recent"] });
    },
  });
}

/** Ruta real por calle entre origen y destino (MOVO-123) para el mapa del paso de
 * resumen del wizard — `enabled` solo cuando ambos puntos ya están definidos. */
export function useShipmentRoute(origin: LatLng | null, destination: LatLng | null) {
  return useQuery({
    queryKey: ["shipments", "route", origin, destination],
    queryFn: () => shipmentsClient.getRoute(origin!, destination!),
    enabled: origin !== null && destination !== null,
    staleTime: 5 * 60 * 1000,
  });
}

/** Detalle de un envío propio — pantalla a la que lleva "Ver envío" al terminar el
 * wizard de creación (MOVO-83). `enabled` solo con un id real (nunca `undefined`). */
export function useShipment(id: string | undefined) {
  return useQuery({
    queryKey: ["shipments", "detail", id],
    queryFn: () => shipmentsClient.getById(id!),
    enabled: !!id,
  });
}
