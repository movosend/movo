import { useMemo, useRef } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ShipmentPartyTracking } from "@movo/shared/dist/types/admin-shipments";
import { shipmentsClient } from "../api/shipments-client";
import type { RoutePoint } from "../lib/route-geometry";
import { decodePolyline } from "../lib/polyline";

export function shipmentTrackingQueryKey(shipmentId: string | undefined, status?: string) {
  return ["shipments", shipmentId, "tracking", status] as const;
}

/**
 * Decodifica una polyline y conserva la última no vacía mientras sea el mismo envío: un `null` pasajero (el
 * proveedor falló y el backend lo cachea) no borra la línea. Sin `enabled` no hay línea.
 */
function useRetainedPolyline(polyline: string | null, shipmentId: string | undefined, enabled: boolean): RoutePoint[] {
  const last = useRef<{ shipmentId: string | undefined; points: RoutePoint[] }>({ shipmentId, points: [] });
  return useMemo<RoutePoint[]>(() => {
    if (polyline) {
      const points = decodePolyline(polyline);
      last.current = { shipmentId, points };
      return points;
    }
    if (!enabled) return [];
    return last.current.shipmentId === shipmentId ? last.current.points : [];
  }, [polyline, shipmentId, enabled]);
}

/**
 * Ruta planificada y recorrido del transportista para el emisor y el receptor (MOVO-346, punto 12;
 * `GET /shipments/:id/tracking`). Se refresca cada `pollIntervalSeconds` del backend mientras el
 * seguimiento está `live` (la traza crece con las posiciones que se persisten); la posición en vivo
 * llega aparte, por el WS (`useLivePosition`). Con el envío cerrado no hay recorrido para las partes.
 * `status` va en la clave: antes del retiro el seguimiento no está `live` (no hay poll), y al pasar a
 * `in_transit` hay que volver a pedirlo.
 *
 * Feedback de TestFlight build 18 ("a veces se rompe el recorrido"): al cambiar la clave las líneas
 * desaparecían hasta que respondía (`keepPreviousData` las sostiene), y un `plannedRoute: null`
 * pasajero (el backend cachea 60 s un fallo de Google) borraba la ruta: se conserva la última no vacía
 * del mismo envío.
 */
export function useShipmentTracking(
  shipmentId: string | undefined,
  options: { enabled?: boolean; status?: string } = {},
) {
  const enabled = (options.enabled ?? true) && !!shipmentId;
  const query = useQuery({
    queryKey: shipmentTrackingQueryKey(shipmentId, options.status),
    queryFn: () => shipmentsClient.getTracking(shipmentId!),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (q) => {
      const data = q.state.data as ShipmentPartyTracking | undefined;
      return data?.state === "live" ? data.pollIntervalSeconds * 1000 : false;
    },
  });
  // Deshabilitada (envío cerrado): sin recorrido, aunque `keepPreviousData` siga sirviendo el del
  // estado anterior bajo la clave nueva (DD-023).
  const data = enabled ? query.data : undefined;
  // Por el string y no por el objeto: cada poll trae un objeto nuevo con la misma ruta, y una ruta
  // "nueva" reinicia la proyección del vehículo en `RouteMapCard`.
  const planned = useRetainedPolyline(data?.plannedRoute?.polyline ?? null, shipmentId, enabled);
  const trace = useMemo<RoutePoint[]>(
    () => (data?.trace ?? []).map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [data?.trace],
  );
  // MOVO-359: ruta del vehículo al retiro (antes del retiro). Como la planificada, la última no vacía se
  // conserva si un pedido la trae `null` (el proveedor falló y el backend lo cachea un minuto): sin ella
  // la línea saltaría de golpe a la ruta entera. Review PR-340: si el campo viene ausente, el backend decidió
  // no calcularla (p. ej. se sumó otro retiro al viaje): esa línea ya es falsa y no se conserva.
  const approach = useRetainedPolyline(
    data?.approachRoute?.polyline ?? null,
    shipmentId,
    enabled && data?.approachRoute !== undefined,
  );
  return { ...query, data, planned, trace, approach };
}
