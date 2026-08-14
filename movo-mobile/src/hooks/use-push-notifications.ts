import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { requestPermissionAndRegisterPushToken } from "../lib/push-registration";
import { useAuthStore } from "../store/auth-store";

/**
 * AC5: banner nativo del SO también con la app en foreground — no se construye un
 * componente de toast/banner nuevo (no hay ninguno auto-dismiss reusable en el repo,
 * `ErrorBanner` es persistente a propósito). Configurado a nivel de módulo, no del
 * hook, para que aplique apenas se carga la app, sin depender de que el hook llegue a
 * montarse primero.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

interface ShipmentNotificationData {
  type: "shipment";
  shipmentId: string;
}

function isShipmentNotificationData(data: unknown): data is ShipmentNotificationData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "shipment"
  );
}

/**
 * AC1-AC3: pide permiso y registra el push token una sola vez por transición a sesión
 * autenticada (mismo criterio de guarda con `ref` que `authRedirectedRef` en
 * `app/index.tsx`, para no repetir el pedido en cada re-render de `app/_layout.tsx`).
 * Corre en paralelo, nunca bloquea `appReady`/el splash — no es un muro (AC1).
 *
 * AC6: navegar al detalle de un envío al tocar la notificación queda sin implementar
 * a propósito — no existe todavía ninguna pantalla de envíos (MOVO-83+, sin arrancar).
 * El parseo de `data.type === 'shipment'` y el punto de extensión quedan listos; falta
 * solo el `router.push(...)` real cuando esa ruta exista.
 */
export function usePushNotifications(): void {
  const sessionStatus = useAuthStore((s) => s.status);
  const registeredRef = useRef(false);

  useEffect(() => {
    if (sessionStatus !== "authenticated" || registeredRef.current) return;
    registeredRef.current = true;
    void requestPermissionAndRegisterPushToken();
  }, [sessionStatus]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") {
      registeredRef.current = false;
    }
  }, [sessionStatus]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (isShipmentNotificationData(data)) {
        // Punto de extensión (AC6) — sin pantalla de detalle de envío todavía
        // (MOVO-83+). Cuando exista: router.push(`/shipments/${data.shipmentId}`).
        console.warn(
          `[push] notificación de envío tocada (shipmentId: ${data.shipmentId}) — sin pantalla de destino todavía`,
        );
      }
    });
    return () => subscription.remove();
  }, []);
}
