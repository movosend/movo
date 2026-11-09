import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "../store/auth-store";
import { TRIPS_LIST_QUERY_KEY } from "./use-trips";

/** Pushes que pueden dejar a un viaje del transportista sin paquetes (el backend ya lo
 * expira en la misma transacción): el emisor canceló el envío. */
const TRIP_CHANGING_PUSH_TYPES: readonly string[] = ["shipment_cancelled"];

/**
 * Mantiene al día los viajes de Inicio cuando el cambio lo hace otra persona. Sin esto,
 * cuando el emisor cancelaba el único envío de un viaje en curso, la card "Estoy
 * transportando" seguía mostrando el viaje con 0 paquetes hasta que algo refrescara la
 * query (feedback de TestFlight, build 17). Mismo patrón que `useChatUnreadSync`: push en
 * primer plano y vuelta de la app a primer plano.
 */
export function useTripsSync(): void {
  const queryClient = useQueryClient();
  const authenticated = useAuthStore((state) => state.status === "authenticated");

  useEffect(() => {
    if (!authenticated) return;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: TRIPS_LIST_QUERY_KEY });

    const received = Notifications.addNotificationReceivedListener((notification) => {
      const type = (notification.request?.content?.data as { type?: unknown } | undefined)?.type;
      if (typeof type === "string" && TRIP_CHANGING_PUSH_TYPES.includes(type)) refresh();
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
