import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuthStore } from "../store/auth-store";
import { getApiBaseUrl } from "../lib/env";
import { refreshTokens } from "../api/http-client";

export type ShipmentChannelConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "error";

export interface RealtimePositionEvent {
  type: "position";
  shipmentId: string;
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  accuracyM: number;
  capturedAt: string;
  recordedAt?: string;
}

export interface RealtimeStatusEvent {
  type: "status";
  shipmentId: string;
  status: string;
}

export type RealtimeMessage =
  | { type: "connected"; shipmentId: string }
  | RealtimePositionEvent
  | RealtimeStatusEvent;

export interface UseShipmentChannelOptions {
  enabled?: boolean;
  onPosition?: (position: RealtimePositionEvent) => void;
  onStatus?: (statusEvent: RealtimeStatusEvent) => void;
}

export interface UseShipmentChannelResult {
  connectionState: ShipmentChannelConnectionState;
  isConnected: boolean;
  isTerminalClosed: boolean;
  lastPosition: RealtimePositionEvent | null;
  reconnect: () => void;
  close: () => void;
}

export type ShipmentPositionPayload = RealtimePositionEvent;
export type ConnectionState = ShipmentChannelConnectionState;

/** Códigos de cierre de protocolo del backend de tracking (RFC 6455 privados) */
const WS_CLOSE_CODES = {
  TOKEN_EXPIRED: 4001,
  FORBIDDEN: 4003,
  NOT_FOUND: 4004,
  STATUS_CLOSED: 4009, // El envío ya está delivered/terminal (MOVO-201 / MOVO-204)
};

/**
 * Convierte la URL base HTTP en una URL WebSocket adecuada para React Native.
 */
export function getWebSocketUrl(shipmentId: string): string {
  const baseUrl = getApiBaseUrl();
  const wsBase = baseUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${wsBase}/api/v1/shipments/${shipmentId}/track`;
}

/**
 * Hook genérico por envío para el canal de tiempo real (MOVO-201 / MOVO-204 / MOVO-250).
 *
 * Características:
 * 1. Resiliencia de red con backoff exponencial progresivo (1s, 2s, 4s... hasta 30s).
 * 2. Reconexión inmediata al volver de segundo plano (AppState === 'active').
 * 3. Renovación de token transparente ante cierre 4001 (JWT vencido en sesión larga).
 * 4. Respeto de cierre terminal ante 4009 (envío delivered) y 4003/4004.
 */
export function useShipmentChannel(
  shipmentId: string | null | undefined,
  options: UseShipmentChannelOptions = {}
): UseShipmentChannelResult {
  const { enabled = true, onPosition, onStatus } = options;
  const accessToken = useAuthStore((state) => state.accessToken);
  const isAuthenticated = useAuthStore((state) => state.status === "authenticated");

  const [connectionState, setConnectionState] = useState<ShipmentChannelConnectionState>("idle");
  const [lastPosition, setLastPosition] = useState<RealtimePositionEvent | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isManuallyClosedRef = useRef(false);
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    clearReconnectTimer();
    if (socketRef.current) {
      const ws = socketRef.current;
      socketRef.current = null;
      try {
        ws.onopen = null as any;
        ws.onmessage = null as any;
        ws.onerror = null as any;
        ws.onclose = null as any;
        ws.close(1000, "Normal closure");
      } catch {
        // Ignorar errores al cerrar
      }
    }
  }, [clearReconnectTimer]);

  const connect = useCallback(() => {
    const currentToken = useAuthStore.getState().accessToken;
    const isAuth = useAuthStore.getState().status === "authenticated";
    if (!enabled || !shipmentId || !isAuth || !currentToken) {
      return;
    }

    if (isManuallyClosedRef.current) {
      return;
    }

    closeSocket();
    setConnectionState((prev) => (prev === "connected" ? "reconnecting" : "connecting"));

    const url = getWebSocketUrl(shipmentId);

    try {
      // En React Native, el constructor nativo de WebSocket soporta { headers }
      // como tercer argumento para inyectar Authorization en el handshake inicial.
      const ws = new (WebSocket as any)(url, undefined, {
        headers: {
          Authorization: `Bearer ${currentToken}`,
        },
      }) as WebSocket;

      socketRef.current = ws;

      ws.onopen = () => {
        if (socketRef.current !== ws) return;
        reconnectAttemptsRef.current = 0;
        setConnectionState("connected");
      };

      ws.onmessage = (event: WebSocketMessageEvent) => {
        if (socketRef.current !== ws) return;
        try {
          const raw = typeof event.data === "string" ? event.data : String(event.data);
          const data = JSON.parse(raw) as RealtimeMessage;

          if (data.type === "connected") {
            setConnectionState("connected");
            reconnectAttemptsRef.current = 0;
          } else if (data.type === "position") {
            setConnectionState("connected");
            setLastPosition(data);
            onPositionRef.current?.(data);
          } else if (data.type === "status") {
            onStatusRef.current?.(data);
          }
        } catch {
          // Ignorar frames no parseables
        }
      };

      ws.onerror = () => {
        // El error dispara ws.onclose, donde se programa la reconexión
      };

      ws.onclose = async (event: WebSocketCloseEvent) => {
        if (socketRef.current !== ws) {
          // Socket reemplazado o cerrado a propósito
          return;
        }
        socketRef.current = null;

        if (isManuallyClosedRef.current) {
          setConnectionState("idle");
          return;
        }

        // Caso 1: Token expirado (4001) -> Refrescar sesión y reconectar con el nuevo token
        if (event.code === WS_CLOSE_CODES.TOKEN_EXPIRED) {
          setConnectionState("reconnecting");
          void (async () => {
            try {
              await refreshTokens();
              if (!isManuallyClosedRef.current && socketRef.current === null) {
                connect();
              }
            } catch {
              setConnectionState("error");
            }
          })();
          return;
        }

        // Caso 2: Cierre terminal de tracking (envío delivered 4009, o forbidden 4003, not found 4004)
        if (
          event.code === WS_CLOSE_CODES.STATUS_CLOSED ||
          event.code === WS_CLOSE_CODES.FORBIDDEN ||
          event.code === WS_CLOSE_CODES.NOT_FOUND
        ) {
          setConnectionState("closed");
          return;
        }

        // Caso 3: Desconexión transitoria de red -> Reconexión con backoff exponencial
        setConnectionState("reconnecting");
        const attempt = reconnectAttemptsRef.current;
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        reconnectAttemptsRef.current = attempt + 1;

        clearReconnectTimer();
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isManuallyClosedRef.current && socketRef.current === null) {
            void connect();
          }
        }, delay);
      };
    } catch {
      setConnectionState("reconnecting");
      const attempt = reconnectAttemptsRef.current;
      const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
      reconnectAttemptsRef.current = attempt + 1;
      clearReconnectTimer();
      reconnectTimeoutRef.current = setTimeout(() => {
        if (!isManuallyClosedRef.current && socketRef.current === null) {
          void connect();
        }
      }, delay);
    }
  }, [enabled, shipmentId, closeSocket, clearReconnectTimer]);

  // Manejo de AppState: reconexión inmediata al volver de segundo plano
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "active") {
        if (enabled && shipmentId && !isManuallyClosedRef.current) {
          if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
            reconnectAttemptsRef.current = 0;
            void connect();
          }
        }
      }
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => sub.remove();
  }, [enabled, shipmentId, connect]);

  // Ciclo de vida del hook: conectar al montar y limpiar al desmontar
  useEffect(() => {
    isManuallyClosedRef.current = false;
    if (enabled && shipmentId && isAuthenticated) {
      void connect();
    } else {
      closeSocket();
      setConnectionState("idle");
    }

    return () => {
      isManuallyClosedRef.current = true;
      closeSocket();
    };
  }, [enabled, shipmentId, isAuthenticated, connect, closeSocket]);

  const reconnect = useCallback(() => {
    isManuallyClosedRef.current = false;
    reconnectAttemptsRef.current = 0;
    void connect();
  }, [connect]);

  const close = useCallback(() => {
    isManuallyClosedRef.current = true;
    closeSocket();
    setConnectionState("closed");
  }, [closeSocket]);

  return {
    connectionState,
    isConnected: connectionState === "connected",
    isTerminalClosed: connectionState === "closed",
    lastPosition,
    reconnect,
    close,
  };
}
