import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "../store/auth-store";
import { bumpSupportUnread, supportKeys } from "./use-support";

/**
 * MOVO-324: mantiene al día el contador de soporte de Perfil sin esperar al polling de la lista. No hay WebSocket
 * global, así que se refresca cuando llega una push `support_message` con la app abierta y cuando vuelve a primer
 * plano. Mismo molde que `use-chat-unread-sync.ts`; va montado una vez dentro de `QueryClientProvider`.
 */
export function useSupportUnreadSync(): void {
  const queryClient = useQueryClient();
  const authenticated = useAuthStore((state) => state.status === "authenticated");

  useEffect(() => {
    if (!authenticated) return;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: supportKeys.list });

    const received = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request?.content?.data as { type?: unknown; conversationId?: unknown } | undefined;
      if (data?.type !== "support_message") return;
      // El contador sube ya; la lista del servidor lo confirma después.
      if (typeof data.conversationId === "string") bumpSupportUnread(queryClient, data.conversationId);
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
