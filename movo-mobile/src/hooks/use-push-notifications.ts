import { router } from "expo-router";
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
    (data as { type?: unknown }).type === "shipment" &&
    typeof (data as { shipmentId?: unknown }).shipmentId === "string"
  );
}

/**
 * AC1-AC3: pide permiso y registra el push token una sola vez por transición a sesión
 * autenticada (mismo criterio de guarda con `ref` que `authRedirectedRef` en
 * `app/index.tsx`, para no repetir el pedido en cada re-render de `app/_layout.tsx`).
 * Corre en paralelo, nunca bloquea `appReady`/el splash — no es un muro (AC1).
 *
 * AC5 / AC6 de MOVO-132: al tocar la notificación (en foreground, background o cold start),
 * navega directo a `/shipments/:id` donde el receptor puede ver el detalle y las
 * acciones de confirmación (MOVO-131).
 */
export function usePushNotifications(): void {
  const sessionStatus = useAuthStore((s) => s.status);
  const registeredRef = useRef(false);
  const handledColdStartRef = useRef(false);

  useEffect(() => {
    if (sessionStatus !== "authenticated" || registeredRef.current) return;
    registeredRef.current = true;
    void requestPermissionAndRegisterPushToken();
  }, [sessionStatus]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") {
      registeredRef.current = false;
      handledColdStartRef.current = false;
    }
  }, [sessionStatus]);

  // Manejo de cold start (app abierta desde la notificación estando cerrada)
  useEffect(() => {
    if (sessionStatus !== "authenticated" || handledColdStartRef.current) return;

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification?.request?.content?.data;
      if (isShipmentNotificationData(data)) {
        handledColdStartRef.current = true;
        router.push(`/shipments/${data.shipmentId}`);
      }
    });
  }, [sessionStatus]);

  // Manejo de interacción con notificación recibida en foreground / background
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification?.request?.content?.data;
      if (isShipmentNotificationData(data)) {
        router.push(`/shipments/${data.shipmentId}`);
      }
    });
    return () => subscription.remove();
  }, []);
}
