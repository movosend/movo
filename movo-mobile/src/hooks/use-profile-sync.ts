import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "../store/auth-store";

/** Prefijo de todas las queries del perfil (propio y público), incluida la reputación. */
const PROFILE_QUERY_KEY = ["profile"] as const;

/**
 * Mantiene al día el perfil cuando alguien te califica. Antes la reseña nueva no aparecía en
 * "Tu reputación" hasta que algo refrescara la query (feedback de TestFlight, build 17). Mismo
 * patrón que `useTripsSync`: push `rating_received` en primer plano y vuelta de la app a primer plano.
 */
export function useProfileSync(): void {
  const queryClient = useQueryClient();
  const authenticated = useAuthStore((state) => state.status === "authenticated");

  useEffect(() => {
    if (!authenticated) return;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });

    const received = Notifications.addNotificationReceivedListener((notification) => {
      const type = (notification.request?.content?.data as { type?: unknown } | undefined)?.type;
      if (type === "rating_received") refresh();
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
