import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "../store/auth-store";
import { bumpChatUnread, chatKeys } from "./use-chat";

/**
 * MOVO-301: mantiene al día el contador de no leídos de Inicio sin esperar los 60 s del polling.
 * No hay WebSocket global, así que se refresca cuando llega una push `chat_message` con la app
 * abierta (el banner ya se muestra, ver `setNotificationHandler`) y cuando la app vuelve a
 * primer plano. Va montado una vez dentro de `QueryClientProvider`.
 */
export function useChatUnreadSync(): void {
  const queryClient = useQueryClient();
  const authenticated = useAuthStore((state) => state.status === "authenticated");

  useEffect(() => {
    if (!authenticated) return;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: chatKeys.list });

    const received = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request?.content?.data as { type?: unknown; shipmentId?: unknown } | undefined;
      if (data?.type !== "chat_message") return;
      // El contador sube ya; la lista del servidor tarda y recién después lo confirma.
      if (typeof data.shipmentId === "string") bumpChatUnread(queryClient, data.shipmentId);
      refresh();
    });
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => {
      received.remove();
      appState.remove();
    };
  }, [authenticated, queryClient]);
}
