import { SUPPORT_WS_CLOSE } from "@movo/shared/dist/types/support";
import type { SupportRealtimeEvent } from "@movo/shared/dist/types/support";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { refreshTokens } from "../api/http-client";
import { getApiBaseUrl } from "../lib/env";
import { useAuthStore } from "../store/auth-store";

/**
 * MOVO-324: WebSocket de recepción de una consulta de soporte (`GET /support/conversations/:id`). Se envía por
 * HTTP; acá solo llegan los mensajes del equipo, los cambios de estado y los tildes. Mismo molde que
 * `use-chat-channel.ts` (backoff, AppState, `4001` refresca el token); `4003` y `4004` son terminales.
 */
export type SupportChannelState = "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "error";

export interface UseSupportChannelOptions {
  enabled?: boolean;
  onMessage?: (event: Extract<SupportRealtimeEvent, { type: "support_message" }>) => void;
  onStatus?: (event: Extract<SupportRealtimeEvent, { type: "support_status" }>) => void;
  onReceipt?: (event: Extract<SupportRealtimeEvent, { type: "support_receipt" }>) => void;
  /** Cada vez que el canal (re)conecta: el historial pudo cambiar mientras estuvo caído. */
  onConnected?: () => void;
  /** Cierre terminal: `4003` sin permiso o `4004` la consulta ya no existe. */
  onTerminalClose?: (code: number) => void;
}

const TERMINAL_CLOSE_CODES: number[] = [SUPPORT_WS_CLOSE.FORBIDDEN, SUPPORT_WS_CLOSE.NOT_FOUND];

export function getSupportWebSocketUrl(conversationId: string): string {
  const wsBase = getApiBaseUrl().replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${wsBase}/api/v1/support/conversations/${conversationId}`;
}

export function useSupportChannel(conversationId: string | null | undefined, options: UseSupportChannelOptions = {}) {
  const { enabled = true } = options;
  const isAuthenticated = useAuthStore((state) => state.status === "authenticated");
  const [state, setState] = useState<SupportChannelState>("idle");

  const socketRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manuallyClosedRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

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
    if (!enabled || !conversationId || !authed || !token || manuallyClosedRef.current) return;

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
        getSupportWebSocketUrl(conversationId),
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
          const data = JSON.parse(String(event.data)) as SupportRealtimeEvent | { type: "connected" };
          if (data.type === "connected") {
            attemptsRef.current = 0;
            setState("connected");
            optionsRef.current.onConnected?.();
          } else if (data.type === "support_message") {
            optionsRef.current.onMessage?.(data);
          } else if (data.type === "support_status") {
            optionsRef.current.onStatus?.(data);
          } else if (data.type === "support_receipt") {
            optionsRef.current.onReceipt?.(data);
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
        if (event.code === SUPPORT_WS_CLOSE.TOKEN_EXPIRED) {
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
          optionsRef.current.onTerminalClose?.(event.code ?? 0);
          return;
        }
        scheduleReconnect();
      };
    } catch {
      scheduleReconnect();
    }
  }, [enabled, conversationId, closeSocket, clearTimer]);

  // Al volver de segundo plano el SO pudo haber matado el socket: reconecta de inmediato.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next !== "active" || !enabled || !conversationId || manuallyClosedRef.current) return;
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        attemptsRef.current = 0;
        connect();
      }
    });
    return () => sub.remove();
  }, [enabled, conversationId, connect]);

  useEffect(() => {
    manuallyClosedRef.current = false;
    if (enabled && conversationId && isAuthenticated) {
      connect();
    } else {
      closeSocket();
      setState("idle");
    }
    return () => {
      manuallyClosedRef.current = true;
      closeSocket();
    };
  }, [enabled, conversationId, isAuthenticated, connect, closeSocket]);

  return { state, isConnected: state === "connected" };
}
