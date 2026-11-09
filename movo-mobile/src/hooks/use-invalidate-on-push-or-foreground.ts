import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "../store/auth-store";

/**
 * Invalida `queryKey` cuando llega en primer plano un push de alguno de `pushTypes`, y cada vez que la app vuelve a
 * primer plano. Para datos que cambia otra persona (una calificación, una cancelación) y que la app no se entera de
 * otra forma. `queryKey` y `pushTypes` tienen que ser estables (constantes del módulo que lo usa): son dependencias
 * del efecto.
 */
export function useInvalidateOnPushOrForeground(queryKey: QueryKey, pushTypes: readonly string[]): void {
  const queryClient = useQueryClient();
  const authenticated = useAuthStore((state) => state.status === "authenticated");

  useEffect(() => {
    if (!authenticated) return;
    const refresh = () => void queryClient.invalidateQueries({ queryKey });

    const received = Notifications.addNotificationReceivedListener((notification) => {
      const type = (notification.request?.content?.data as { type?: unknown } | undefined)?.type;
      if (typeof type === "string" && pushTypes.includes(type)) refresh();
    });
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => {
      received.remove();
      appState.remove();
    };
  }, [authenticated, queryClient, queryKey, pushTypes]);
}
