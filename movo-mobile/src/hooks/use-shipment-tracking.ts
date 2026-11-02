import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ShipmentPartyTracking } from "@movo/shared/dist/types/admin-shipments";
import { shipmentsClient } from "../api/shipments-client";
import type { RoutePoint } from "../lib/route-geometry";
import { decodePolyline } from "../lib/polyline";

export function shipmentTrackingQueryKey(shipmentId: string | undefined, status?: string) {
  return ["shipments", shipmentId, "tracking", status] as const;
}

/**
 * Ruta planificada y recorrido del transportista para el emisor y el receptor (MOVO-346, punto 12;
 * `GET /shipments/:id/tracking`). Se refresca cada `pollIntervalSeconds` del backend mientras el
 * seguimiento está `live` (la traza crece con las posiciones que se persisten); la posición en vivo
 * llega aparte, por el WS (`useLivePosition`). Con el envío cerrado no hay recorrido para las partes.
 * `status` va en la clave: antes del retiro el seguimiento no está `live` (no hay poll), y al pasar a
 * `in_transit` hay que volver a pedirlo.
 */
export function useShipmentTracking(
  shipmentId: string | undefined,
  options: { enabled?: boolean; status?: string } = {},
) {
  const query = useQuery({
    queryKey: shipmentTrackingQueryKey(shipmentId, options.status),
    queryFn: () => shipmentsClient.getTracking(shipmentId!),
    enabled: (options.enabled ?? true) && !!shipmentId,
    refetchInterval: (q) => {
      const data = q.state.data as ShipmentPartyTracking | undefined;
      return data?.state === "live" ? data.pollIntervalSeconds * 1000 : false;
    },
  });
  const data = query.data;
  const planned = useMemo<RoutePoint[]>(
    () => (data?.plannedRoute ? decodePolyline(data.plannedRoute.polyline) : []),
    [data?.plannedRoute],
  );
  const trace = useMemo<RoutePoint[]>(
    () => (data?.trace ?? []).map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [data?.trace],
  );
  return { ...query, planned, trace };
}
