import type { ChatMessage, ChatRealtimeEvent } from "@movo/shared/dist/types/chat";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { refreshTokens } from "../api/http-client";
import { getApiBaseUrl } from "../lib/env";
import { useAuthStore } from "../store/auth-store";

/**
 * MOVO-284: WebSocket de recepción del chat (`GET /shipments/:id/chat`, ADR-040). Se envía por
 * HTTP; acá solo llegan los mensajes de los demás y los tildes. Mismo molde que
 * `use-shipment-channel.ts` (backoff, AppState, 4001 refresca el token), con una diferencia:
 * `4009` es "chat cerrado" y es terminal igual que `4003`/`4004`.
 */
export type ChatChannelState = "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "error";

export interface UseChatChannelOptions {
  enabled?: boolean;
  onMessage?: (message: ChatMessage) => void;
  onReceipt?: (event: Extract<ChatRealtimeEvent, { type: "chat_receipt" }>) => void;
  /** Cada vez que el canal (re)conecta: el historial pudo cambiar mientras estuvo caído. */
  onConnected?: () => void;
  /** MOVO-340: cambiaron los integrantes del hilo (transferencia de receptor completada). */
  onParticipantsChanged?: () => void;
}

const CLOSE_TOKEN_EXPIRED = 4001;
const TERMINAL_CLOSE_CODES = [4003, 4004, 4009];

export function getChatWebSocketUrl(shipmentId: string): string {
  const wsBase = getApiBaseUrl().replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${wsBase}/api/v1/shipments/${shipmentId}/chat`;
}

export function useChatChannel(shipmentId: string | null | undefined, options: UseChatChannelOptions = {}) {
  const { enabled = true, onMessage, onReceipt, onConnected, onParticipantsChanged } = options;
  const isAuthenticated = useAuthStore((state) => state.status === "authenticated");
  const [state, setState] = useState<ChatChannelState>("idle");

  const socketRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manuallyClosedRef = useRef(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onReceiptRef = useRef(onReceipt);
  onReceiptRef.current = onReceipt;
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  const onParticipantsChangedRef = useRef(onParticipantsChanged);
  onParticipantsChangedRef.current = onParticipantsChanged;

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const closeSocket = useCallback(() => {
    clearTimer();
    const ws = socketRef.current;
    socketRef.current = null;
    if (!ws) return;
    try {
      ws.onopen = null as never;
      ws.onmessage = null as never;
      ws.onerror = null as never;
      ws.onclose = null as never;
      ws.close(1000, "Normal closure");
    } catch {
      // Ya estaba cerrado.
    }
  }, [clearTimer]);

  const connect = useCallback(() => {
    const token = useAuthStore.getState().accessToken;
    const authed = useAuthStore.getState().status === "authenticated";
    if (!enabled || !shipmentId || !authed || !token || manuallyClosedRef.current) return;

    closeSocket();
    setState((prev) => (prev === "connected" ? "reconnecting" : "connecting"));

    const scheduleReconnect = () => {
      setState("reconnecting");
      const attempt = attemptsRef.current;
      attemptsRef.current = attempt + 1;
      clearTimer();
      timerRef.current = setTimeout(() => {
        if (!manuallyClosedRef.current && socketRef.current === null) connect();
      }, Math.min(1000 * 2 ** attempt, 30_000));
    };

    try {
      // React Native admite headers como tercer argumento: el JWT va en el handshake.
      const ws = new (WebSocket as unknown as new (url: string, protocols?: string[], options?: object) => WebSocket)(
        getChatWebSocketUrl(shipmentId),
        undefined,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      socketRef.current = ws;

      ws.onopen = () => {
        if (socketRef.current !== ws) return;
        attemptsRef.current = 0;
        setState("connected");
      };

      ws.onmessage = (event: WebSocketMessageEvent) => {
        if (socketRef.current !== ws) return;
        try {
          const data = JSON.parse(String(event.data)) as ChatRealtimeEvent | { type: "connected" };
          if (data.type === "connected") {
            attemptsRef.current = 0;
            setState("connected");
            onConnectedRef.current?.();
          } else if (data.type === "chat_message") {
            onMessageRef.current?.(data.message);
          } else if (data.type === "chat_receipt") {
            onReceiptRef.current?.(data);
          } else if (data.type === "chat_participants_changed") {
            onParticipantsChangedRef.current?.();
          }
        } catch {
          // Frame que no se puede parsear: se ignora.
        }
      };

      ws.onerror = () => {
        // El cierre que sigue programa la reconexión.
      };

      ws.onclose = (event: WebSocketCloseEvent) => {
        if (socketRef.current !== ws) return;
        socketRef.current = null;
        if (manuallyClosedRef.current) {
          setState("idle");
          return;
        }
        if (event.code === CLOSE_TOKEN_EXPIRED) {
          setState("reconnecting");
          void refreshTokens()
            .then(() => {
              if (!manuallyClosedRef.current && socketRef.current === null) connect();
            })
            .catch(() => setState("error"));
          return;
        }
        if (TERMINAL_CLOSE_CODES.includes(event.code ?? 0)) {
          setState("closed");
          return;
        }
        scheduleReconnect();
      };
    } catch {
      scheduleReconnect();
    }
  }, [enabled, shipmentId, closeSocket, clearTimer]);

  // Al volver de segundo plano el SO pudo haber matado el socket: reconecta de inmediato.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next !== "active" || !enabled || !shipmentId || manuallyClosedRef.current) return;
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        attemptsRef.current = 0;
        connect();
      }
    });
    return () => sub.remove();
  }, [enabled, shipmentId, connect]);

  useEffect(() => {
    manuallyClosedRef.current = false;
    if (enabled && shipmentId && isAuthenticated) {
      connect();
    } else {
      closeSocket();
      setState("idle");
    }
    return () => {
      manuallyClosedRef.current = true;
      closeSocket();
    };
  }, [enabled, shipmentId, isAuthenticated, connect, closeSocket]);

  return { state, isConnected: state === "connected" };
}
