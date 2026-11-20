import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { useAuthStore } from "../store/auth-store";

/** Pushes de un cambio de estado del envío que hace otra persona (Movo, desde el panel): abrir o resolver una disputa. */
const SHIPMENT_CHANGING_PUSH_TYPES: readonly string[] = ["dispute_opened", "dispute_resolved"];

/** Lo que muestra el estado del envío: el detalle (también lo usa el chat), su línea de tiempo y las listas propias
 * ("Mis envíos" y los activos de Inicio, de donde sale un envío cerrado por la resolución). */
const SHIPMENT_QUERY_PREFIXES = [
  ["shipments", "detail"],
  ["shipments", "events"],
  ["shipments", "mine"],
  ["shipments", "active"],
] as const;

/**
 * Refresca el envío cuando llega en primer plano una push de disputa. Sin esto, con el chat abierto la resolución no
 * aparecía hasta salir y volver (feedback de TestFlight, build 19). Solo con la push: a diferencia de
 * `useInvalidateOnPushOrForeground`, no refresca al volver a primer plano, porque estas queries ya se refrescan al montar
 * la pantalla.
 */
export function useShipmentsSync(): void {
  const queryClient = useQueryClient();
  const authenticated = useAuthStore((state) => state.status === "authenticated");

  useEffect(() => {
    if (!authenticated) return;
    const received = Notifications.addNotificationReceivedListener((notification) => {
      const type = (notification.request?.content?.data as { type?: unknown } | undefined)?.type;
      if (typeof type !== "string" || !SHIPMENT_CHANGING_PUSH_TYPES.includes(type)) return;
      for (const queryKey of SHIPMENT_QUERY_PREFIXES) void queryClient.invalidateQueries({ queryKey });
    });
    return () => received.remove();
  }, [authenticated, queryClient]);
}
