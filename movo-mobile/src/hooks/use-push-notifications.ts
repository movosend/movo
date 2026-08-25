import { router, useRootNavigationState } from "expo-router";
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

/**
 * MOVO-144: las pushes de decisión de oferta (`offer_accepted`/`offer_superseded`/
 * `offer_rejected`, `offers.service.ts` en `svc-shipments`) llevan `shipmentId` con
 * el mismo shape que las de `shipment` (MOVO-107/132) — tocarlas navega al mismo
 * detalle de envío hasta que exista una pantalla propia de oferta (MOVO-150).
 */
const NAVIGABLE_NOTIFICATION_TYPES: readonly string[] = [
  "shipment",
  "offer_accepted",
  "offer_superseded",
  "offer_rejected",
];

interface ShipmentNotificationData {
  type: string;
  shipmentId: string;
}

function isShipmentNotificationData(data: unknown): data is ShipmentNotificationData {
  return (
    typeof data === "object" &&
    data !== null &&
    NAVIGABLE_NOTIFICATION_TYPES.includes((data as { type?: unknown }).type as string) &&
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
  const rootNavState = useRootNavigationState();
  const isNavigatorMounted = Boolean(rootNavState?.key);

  const registeredRef = useRef(false);
  const handledResponseIdsRef = useRef<Set<string>>(new Set());
  const coldStartHandledRef = useRef(false);

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

  // Manejo de cold start (app abierta desde la notificación estando cerrada)
  // Gated por `isNavigatorMounted` para no disparar router.push antes de que
  // el Root Layout monte el <Stack> (evita fallo en cold start).
  useEffect(() => {
    if (sessionStatus !== "authenticated" || !isNavigatorMounted || coldStartHandledRef.current) {
      return;
    }
    coldStartHandledRef.current = true;

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification?.request?.content?.data;
      if (!isShipmentNotificationData(data)) return;

      const responseId =
        response.notification?.request?.identifier ||
        `${data.shipmentId}-${response.notification?.date ?? Date.now()}`;
      if (handledResponseIdsRef.current.has(responseId)) return;
      handledResponseIdsRef.current.add(responseId);

      router.push(`/shipments/${data.shipmentId}`);
    });
  }, [sessionStatus, isNavigatorMounted]);

  // Manejo de interacción con notificación recibida en foreground / background
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification?.request?.content?.data;
      if (!isShipmentNotificationData(data)) return;

      const responseId =
        response.notification?.request?.identifier ||
        `${data.shipmentId}-${response.notification?.date ?? Date.now()}`;
      if (handledResponseIdsRef.current.has(responseId)) return;
      handledResponseIdsRef.current.add(responseId);

      router.push(`/shipments/${data.shipmentId}`);
    });
    return () => subscription.remove();
  }, []);
}
