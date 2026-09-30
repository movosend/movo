import { useQuery } from "@tanstack/react-query";
import { shipmentsClient } from "../api/shipments-client";

/**
 * Envíos activos por rol para el home operativo (MOVO-193) — `GET /shipments/sending`
 * / `GET /shipments/receiving` (MOVO-192, todavía sin backend). Mientras el endpoint
 * no exista, la request falla y la sección correspondiente simplemente no se
 * renderiza (mismo criterio que cualquier otra query fallida no bloqueante del home,
 * ver `RecentShipmentsSection`) — no hay mock local en runtime, solo en tests.
 *
 * `getTransporting` es consumido por `CarrierTransportingSection` (MOVO-252) para
 * calcular el número real de paradas del carrier activo o a punto de iniciar viaje.
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

export function useTransportingShipments() {
  return useQuery({
    queryKey: ["shipments", "active", "transporting"],
    queryFn: () => shipmentsClient.getTransporting(),
  });
}

