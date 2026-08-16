import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { shipmentsClient, type CreateShipmentInput, type ShipmentSummary } from "../api/shipments-client";

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
