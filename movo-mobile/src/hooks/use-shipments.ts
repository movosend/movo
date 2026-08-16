import { useQuery } from "@tanstack/react-query";
import { shipmentsClient } from "../api/shipments-client";

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
