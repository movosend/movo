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
  destination?: { lat: number; lng: number } | null;
  enabled?: boolean;
  demo?: boolean;
}

export type TrackingStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "stale"
  | "closed"
  | "no_position";

const STALE_THRESHOLD_MS = 120_000; // 2 minutos (AC5)

/**
 * Distancia Haversine en kilómetros entre dos coordenadas geográficas.
 */
export function calculateHaversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Radio de la Tierra en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(1));
}

/**
 * Formatea el tiempo transcurrido desde `capturedAt`.
 */
export function formatTimeAgo(isoDateString?: string | null): string {
  if (!isoDateString) return "Sin datos";
  const diffMs = Date.now() - new Date(isoDateString).getTime();
  if (diffMs < 0) return "hace unos segundos";
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 45) return "hace unos segundos";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes === 1) return "hace 1 min";
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours === 1) return "hace 1 h";
  return `hace ${diffHours} h`;
}

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
  const { destination, enabled = true, demo = false } = options;

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
    enabled: Boolean(shipmentId) && enabled && !demo,
    staleTime: 10_000,
  });

  // Simulación en vivo para modo demo (probar telemetría en dispositivo real)
  useEffect(() => {
    if (!demo) return;
    const startLat = -31.3850;
    const startLng = -64.2250;
    setLivePosition({
      lat: startLat,
      lng: startLng,
      accuracyM: 8,
      heading: 145,
      speed: 12.5,
      capturedAt: new Date().toISOString(),
    });

    let step = 0;
    const interval = setInterval(() => {
      step += 1;
      const progress = (step % 200) / 200;
      const curLat = startLat + progress * (-31.9140 - startLat) * 0.2;
      const curLng = startLng + progress * (-63.6820 - startLng) * 0.2;
      setLivePosition({
        lat: curLat,
        lng: curLng,
        accuracyM: 6 + Math.round(Math.random() * 4),
        heading: 140 + Math.round(Math.random() * 10),
        speed: 11 + Math.random() * 3,
        capturedAt: new Date().toISOString(),
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [demo]);

  // Inicializar o sincronizar con la posición inicial cuando se carga
  useEffect(() => {
    if (initialPosition && !livePosition && !demo) {
      setLivePosition({
        lat: initialPosition.lat,
        lng: initialPosition.lng,
        accuracyM: initialPosition.accuracyM,
        capturedAt: initialPosition.capturedAt,
      });
    }
  }, [initialPosition, demo]);

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
    enabled: enabled && !demo && !isDelivered,
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

  // Derivar el estado general de tracking
  const trackingStatus: TrackingStatus = useMemo(() => {
    if (demo) return "live";
    if (isDelivered || isTerminalClosed) return "closed";
    if (connectionState === "reconnecting") return "reconnecting";
    if (!livePosition) return "no_position";
    if (isStale) return "stale";
    if (connectionState === "connected") return "live";
    return "connecting";
  }, [demo, isDelivered, isTerminalClosed, connectionState, livePosition, isStale]);

  // Texto amigable de última actualización
  const lastUpdateText = useMemo(() => {
    return formatTimeAgo(livePosition?.capturedAt);
  }, [livePosition?.capturedAt, ticker]);

  // Distancia restante en km al destino
  const distanceKm = useMemo(() => {
    if (!livePosition || !destination) return null;
    return calculateHaversineKm(
      livePosition.lat,
      livePosition.lng,
      destination.lat,
      destination.lng
    );
  }, [livePosition, destination]);

  // Estimación de tiempo en minutos basada en distancia (asumiendo velocidad promedio urbana de 30-40 km/h)
  const estimatedArrivalMinutes = useMemo(() => {
    if (distanceKm == null) return null;
    // Si la distancia es muy chica (< 0.2 km), ~2 min
    if (distanceKm < 0.2) return 2;
    // Estimación: ~2 minutos por km en entorno urbano/interurbano
    return Math.max(3, Math.round(distanceKm * 2));
  }, [distanceKm]);

  return {
    position: livePosition,
    trackingStatus,
    isStale,
    isDelivered: isDelivered || isTerminalClosed,
    distanceKm,
    estimatedArrivalMinutes,
    lastUpdateText,
    isLoadingInitial,
    refetchInitial,
    reconnectWs: reconnect,
    rawConnectionState: connectionState,
  };
}
