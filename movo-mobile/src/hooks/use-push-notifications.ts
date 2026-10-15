import { router, usePathname, useRootNavigationState } from "expo-router";
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

/** Las dos formas de ruta que puede devolver `resolveNotificationRoute` — un `href`
 * de solo path para los tipos que no llevan query params, o la forma objeto de
 * expo-router para los que sí (evita concatenar/interpolar el query string a mano,
 * que no encodea valores especiales). */
export type NotificationRoute = string | { pathname: string; params: Record<string, string> };

/** `data.type` que abren el detalle del envío (`/shipments/:shipmentId`). */
const SHIPMENT_DETAIL_TYPES: readonly string[] = [
  "shipment",
  "shipment_accepted",
  "shipment_cancelled",
  "offer_accepted",
  "rating_received",
  // MOVO-274: el detalle tiene la acción de calificar (MOVO-153).
  "rating_pending",
  // MOVO-275: novedades de una transferencia de receptor; la invitación tiene su pantalla.
  "receiver_transfer",
  "custody_pickup_confirmed",
  "custody_delivery_confirmed",
  "trip_started",
  // MOVO-240: el transportista está por llegar; el detalle tiene el seguimiento en vivo.
  "carrier_nearby",
];

/** MOVO-281: el resultado de una oferta se mira en su detalle. `offer_superseded` y
 * `offer_voided` llegan con el envío ya `assigned`/`cancelled`, y ese detalle le
 * responde 403 a un transportista que no es parte del envío. Sin `offerId` (una push vieja,
 * anterior a que el backend lo mandara) abre "Mis ofertas", que siempre responde. */
const OFFER_DETAIL_TYPES: readonly string[] = ["offer_superseded", "offer_rejected", "offer_voided"];

/** Abren el feed de Transportar filtrado por el viaje (MOVO-163): `trip_match` y el
 * recordatorio del día anterior (MOVO-240), donde se buscan envíos de paso. */
const TRIP_FEED_TYPES: readonly string[] = ["trip_match", "trip_reminder"];

/** Abren el detalle del viaje: el auto-creado al aceptar una oferta (MOVO-236) y las
 * ocurrencias de una serie recurrente, la declarada y la que cortó la serie (MOVO-266). */
const TRIP_DETAIL_TYPES: readonly string[] = [
  "trip_auto_created",
  "trip_recurrence_generated",
  "trip_recurrence_stopped",
];

const ACCOUNT_SECURITY_TYPES: readonly string[] = [
  "account_password_changed",
  "account_email_changed",
  "account_phone_changed",
];

function stringField(data: object, key: string): string | null {
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** MOVO-274: `kyc_result` trae `verificationType` y `status`. Un rechazo lleva a
 * reintentar (mismos destinos que `transport.tsx` y el banner de `profile.tsx`); en revisión
 * manual va a Inicio, donde el banner de KYC muestra el estado. Aprobado: la identidad va a
 * Inicio, y la licencia a Transportar, que es lo que la licencia habilita (ADR-036). */
function resolveKycRoute(data: object): NotificationRoute | null {
  const verificationType = stringField(data, "verificationType");
  const status = stringField(data, "status");
  if (verificationType !== "identity" && verificationType !== "license") return null;
  if (status === "approved") return verificationType === "license" ? "/(app)/(tabs)/transport" : "/home";
  if (status === "manual_review") return "/home";
  if (status !== "rejected") return null;
  return verificationType === "identity" ? "/kyc" : { pathname: "/license-kyc", params: { status } };
}

/**
 * Resuelve a qué ruta navegar según el `data.type` de la notificación, o `null` si el
 * tipo es desconocido o le falta el id que necesita la ruta (no navega y no rompe).
 */
export function resolveNotificationRoute(data: unknown): NotificationRoute | null {
  if (typeof data !== "object" || data === null) return null;
  const type = stringField(data, "type");
  if (!type) return null;

  if (SHIPMENT_DETAIL_TYPES.includes(type)) {
    const shipmentId = stringField(data, "shipmentId");
    return shipmentId ? `/shipments/${shipmentId}` : null;
  }
  if (type === "shipment_rejected") {
    // El copy le dice al emisor que puede elegir otro receptor (MOVO-253).
    const shipmentId = stringField(data, "shipmentId");
    return shipmentId ? `/shipments/${shipmentId}/change-receiver` : null;
  }
  if (type === "offer_created") {
    const shipmentId = stringField(data, "shipmentId");
    return shipmentId ? `/shipments/${shipmentId}/offers` : null;
  }
  if (OFFER_DETAIL_TYPES.includes(type)) {
    const offerId = stringField(data, "offerId");
    return offerId ? `/carrier/offers/${offerId}` : "/carrier/offers";
  }
  // MOVO-284: un mensaje nuevo abre la conversación del envío (la push no lleva el texto).
  if (type === "chat_message") {
    const shipmentId = stringField(data, "shipmentId");
    return shipmentId ? `/shipments/${shipmentId}/chat` : null;
  }
  if (type === "receiver_transfer_invite") {
    // MOVO-275: la invitación (o su cancelación) abre su pantalla, que muestra si sigue vigente.
    const transferId = stringField(data, "transferId");
    return transferId ? `/receiver-transfers/${transferId}` : null;
  }
  if (TRIP_DETAIL_TYPES.includes(type)) {
    const tripId = stringField(data, "tripId");
    return tripId ? `/carrier/trips/${tripId}` : null;
  }
  if (TRIP_FEED_TYPES.includes(type)) {
    const tripId = stringField(data, "tripId");
    // Forma objeto: un `tripId` con un carácter que necesite URL-encoding rompería
    // el query string armado a mano.
    return tripId ? { pathname: "/(app)/(tabs)/transport", params: { tripId } } : null;
  }
  if (ACCOUNT_SECURITY_TYPES.includes(type)) return "/profile/security";
  if (type === "kyc_result") return resolveKycRoute(data);

  return null;
}

function notificationRouteKey(route: NotificationRoute): string {
  return typeof route === "string" ? route : `${route.pathname}?${new URLSearchParams(route.params).toString()}`;
}

/**
 * Respuestas ya atendidas y cold start ya resuelto, a nivel de módulo: `getLastNotificationResponseAsync`
 * devuelve la última respuesta aunque ya se haya manejado, y si el hook se remonta (logout → login)
 * un `ref` por instancia la volvería a navegar (MOVO-301).
 */
const handledResponseIds = new Set<string>();
let coldStartHandled = false;

/** Solo para tests: cada caso arranca sin recordar respuestas ni cold start de otro. */
export function resetPushHandlingForTests(): void {
  handledResponseIds.clear();
  coldStartHandled = false;
}

/**
 * Navega a la ruta resuelta de una notificación, con dedup por `responseId` — antes
 * duplicado tal cual entre el manejo de cold start y el de foreground/background. Si esa
 * conversación/pantalla ya es la actual no apila otra copia (MOVO-301).
 */
function handleNotificationResponse(response: Notifications.NotificationResponse, currentPathname: string): void {
  const data = response.notification?.request?.content?.data;
  const route = resolveNotificationRoute(data);
  if (!route) return;

  const responseId =
    response.notification?.request?.identifier ||
    `${notificationRouteKey(route)}-${response.notification?.date ?? Date.now()}`;
  if (handledResponseIds.has(responseId)) return;
  handledResponseIds.add(responseId);
  if (typeof route === "string" ? route === currentPathname : route.pathname === currentPathname) return;

  // `as any`: `route` es una unión de dos formas armadas en runtime, no un literal
  // de ruta tipado — mismo criterio que el resto del repo para rutas que
  // expo-router no puede tipar de antemano.
  router.push(route as any);
}

/**
 * AC1-AC3: pide permiso y registra el push token una sola vez por transición a sesión
 * autenticada (mismo criterio de guarda con `ref` que `authRedirectedRef` en
 * `app/index.tsx`, para no repetir el pedido en cada re-render de `app/_layout.tsx`).
 * Corre en paralelo, nunca bloquea `appReady`/el splash — no es un muro (AC1).
 *
 * Al tocar la notificación (en foreground, background o cold start) navega a la ruta
 * que resuelve `resolveNotificationRoute` según su `data.type`.
 */
export function usePushNotifications(): void {
  const sessionStatus = useAuthStore((s) => s.status);
  const rootNavState = useRootNavigationState();
  const isNavigatorMounted = Boolean(rootNavState?.key);

  // Ruta actual en un ref: el listener se suscribe una sola vez y tiene que ver la de ahora, no la del montaje.
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

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

  // Manejo de cold start (app abierta desde la notificación estando cerrada)
  // Gated por `isNavigatorMounted` para no disparar router.push antes de que
  // el Root Layout monte el <Stack> (evita fallo en cold start).
  useEffect(() => {
    if (sessionStatus !== "authenticated" || !isNavigatorMounted || coldStartHandled) {
      return;
    }
    coldStartHandled = true;

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      handleNotificationResponse(response, pathnameRef.current);
    });
  }, [sessionStatus, isNavigatorMounted]);

  // Manejo de interacción con notificación recibida en foreground / background
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response, pathnameRef.current);
    });
    return () => subscription.remove();
  }, []);
}
