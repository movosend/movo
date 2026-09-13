import { useQuery } from "@tanstack/react-query";
import { shipmentsClient } from "../api/shipments-client";

/**
 * Envíos activos por rol para el home operativo (MOVO-193) — `GET /shipments/sending`
 * / `GET /shipments/receiving` (MOVO-192, todavía sin backend). Mientras el endpoint
 * no exista, la request falla y la sección correspondiente simplemente no se
 * renderiza (mismo criterio que cualquier otra query fallida no bloqueante del home,
 * ver `RecentShipmentsSection`) — no hay mock local en runtime, solo en tests.
 *
 * "Estoy transportando" (`getTransporting`) queda para una fase 2 de esta misma US,
 * con un layout distinto (card de "viaje del día" agregado, no una card por envío,
 * ver `Viaje del transportista.dc.html`) que depende de MOVO-206 — no se agrega acá
 * todavía.
 */
export function useSendingShipments() {
  return useQuery({
    queryKey: ["shipments", "active", "sending"],
    queryFn: () => shipmentsClient.getSending(),
  });
}

export function useReceivingShipments() {
  return useQuery({
    queryKey: ["shipments", "active", "receiving"],
    queryFn: () => shipmentsClient.getReceiving(),
  });
}
