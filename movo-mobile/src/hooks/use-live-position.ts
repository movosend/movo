import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  shipmentsClient,
  type LastKnownCarrierPosition,
} from "../api/shipments-client";
import {
  useShipmentChannel,
  type RealtimePositionEvent,
  type RealtimeStatusEvent,
  type ConnectionState,
} from "./use-shipment-channel";

export interface LiveCarrierPosition {
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  accuracyM?: number;
  capturedAt: string;
}

export interface UseLivePositionOptions {
  enabled?: boolean;
}

const STALE_THRESHOLD_MS = 120_000; // 2 minutos (AC5)

/**
 * Hook para emisor y receptor que sincroniza la posición en tiempo real del transportista (MOVO-204).
 *
 * Flujo:
 * 1. Obtiene la última posición persistida vía HTTP (GET /shipments/:id/positions/latest).
 * 2. Conecta al WebSocket del canal del envío (useShipmentChannel).
 * 3. Actualiza el estado al recibir eventos "position".
 * 4. Controla la obsolescencia (> 2 minutos sin updates = "stale" / pausado).
 * 5. Si el envío llega a "delivered", el backend cierra el canal con código 4009 ("closed").
 */
export function useLivePosition(
  shipmentId: string | undefined,
  options: UseLivePositionOptions = {}
) {
  const { enabled = true } = options;

  const [livePosition, setLivePosition] = useState<LiveCarrierPosition | null>(null);
  const [isDelivered, setIsDelivered] = useState(false);
  const [ticker, setTicker] = useState(0);

  // Consulta inicial HTTP: última posición conocida del transportista
  const {
    data: initialPosition,
    isLoading: isLoadingInitial,
    refetch: refetchInitial,
  } = useQuery({
    queryKey: ["shipments", shipmentId, "positions", "latest"],
    queryFn: () => shipmentsClient.getLastKnownPosition(shipmentId!),
    enabled: Boolean(shipmentId) && enabled,
    staleTime: 10_000,
  });

  // Inicializar o sincronizar con la posición inicial cuando se carga
  useEffect(() => {
    if (initialPosition && !livePosition) {
      setLivePosition({
        lat: initialPosition.lat,
        lng: initialPosition.lng,
        accuracyM: initialPosition.accuracyM,
        capturedAt: initialPosition.capturedAt,
      });
    }
  }, [initialPosition]);

  // Manejador de eventos WebSocket de posición
  const handlePositionMessage = useCallback((payload: RealtimePositionEvent) => {
    setLivePosition({
      lat: payload.lat,
      lng: payload.lng,
      heading: payload.heading,
      speed: payload.speed,
      capturedAt: payload.capturedAt,
    });
  }, []);

  // Manejador de eventos WebSocket de cambio de estado
  const handleStatusMessage = useCallback((event: RealtimeStatusEvent) => {
    if (event.status === "delivered" || event.status === "cancelled") {
      setIsDelivered(true);
    }
  }, []);

  // Canal WebSocket
  const {
    connectionState,
    isTerminalClosed,
    reconnect,
  } = useShipmentChannel(shipmentId, {
    enabled: enabled && !isDelivered,
    onPosition: handlePositionMessage,
    onStatus: handleStatusMessage,
  });

  // Timer para verificar obsolescencia de posición cada 10 segundos
  useEffect(() => {
    if (!livePosition) return;
    const interval = setInterval(() => {
      setTicker((prev) => prev + 1);
    }, 10_000);
    return () => clearInterval(interval);
  }, [livePosition]);

  // Determinar si la posición está obsoleta (> 2 min sin updates)
  const isStale = useMemo(() => {
    if (!livePosition?.capturedAt) return false;
    const elapsed = Date.now() - new Date(livePosition.capturedAt).getTime();
    return elapsed > STALE_THRESHOLD_MS;
  }, [livePosition?.capturedAt, ticker]);

  return {
    position: livePosition,
    isStale,
    isDelivered: isDelivered || isTerminalClosed,
    isLoadingInitial,
    refetchInitial,
    reconnectWs: reconnect,
    rawConnectionState: connectionState,
  };
}
