import { router, useGlobalSearchParams, usePathname, useRootNavigationState } from "expo-router";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import {
  ACCOUNT_DISABLED_NOTIFICATION_TYPE,
  ACCOUNT_SANCTION_CLEARED_NOTIFICATION_TYPES,
  notificationType,
} from "../lib/account-restriction";
import { claimColdStart, claimNotificationResponse } from "../lib/notification-response-log";
import { requestPermissionAndRegisterPushToken } from "../lib/push-registration";
import { KycStatus } from "@movo/shared/dist/types/user";
import { useAuthStore } from "../store/auth-store";
import { useBootStore } from "../store/boot-store";

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
  // MOVO-334: hasta que exista la pantalla del expediente (MOVO-30), la push de disputa
  // abierta lleva al detalle del envío, que ya muestra el estado `disputed`.
  "dispute_opened",
];

/** MOVO-281: el resultado de una oferta se mira en su detalle. `offer_superseded` y
 * `offer_voided` llegan con el envío ya `assigned`/`cancelled`, y ese detalle le
 * responde 403 a un transportista que no es parte del envío. Sin `offerId` (una push vieja,
 * anterior a que el backend lo mandara) abre "Mis ofertas", que siempre responde. */
const OFFER_DETAIL_TYPES: readonly string[] = [
  "offer_superseded",
  "offer_rejected",
  "offer_voided",
  // MOVO-310: la penalidad por bajarse de un envío; ese envío ya no es suyo (403).
  "carrier_withdrawal_penalty",
];

/** Abren el feed de Transportar filtrado por el viaje (MOVO-163): `trip_match` y el
 * recordatorio del día anterior (MOVO-240), donde se buscan envíos de paso. */
const TRIP_FEED_TYPES: readonly string[] = ["trip_match", "trip_reminder"];

/** Abren el detalle del viaje: el auto-creado al aceptar una oferta (MOVO-236) y las
 * ocurrencias de una serie recurrente, la declarada y la que cortó la serie (MOVO-266). */
const TRIP_DETAIL_TYPES: readonly string[] = [
  "trip_auto_created",
  "trip_recurrence_generated",
  "trip_recurrence_stopped",
  "trip_recurrence_blocked",
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
 * Inicio, y la licencia a Transportar, que es lo que la licencia habilita (DD-036). */
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
  // MOVO-284: un mensaje nuevo abre la conversación del envío (la push trae nombre, rol y texto, DD-046).
  if (type === "chat_message") {
    const shipmentId = stringField(data, "shipmentId");
    return shipmentId ? `/shipments/${shipmentId}/chat` : null;
  }
  // MOVO-324: la respuesta del equipo de Movo abre la consulta (con la lista de consultas debajo, ver `handleNotificationResponse`).
  if (type === "support_message") {
    const conversationId = stringField(data, "conversationId");
    return conversationId ? `/support/${conversationId}` : null;
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
  // MOVO-300 AC6: la suspensión abre su detalle; el levantamiento y el vencimiento, el inicio.
  if (type === "account_suspended") return "/account-status";
  // MOVO-37 (M5): la comisión de un envío en efectivo quedó como saldo: abre la cuenta corriente (MOVO-315).
  if (type === "cash_commission") return { pathname: "/profile/payments", params: { tab: "balance" } };
  if (ACCOUNT_SANCTION_CLEARED_NOTIFICATION_TYPES.includes(type)) return "/home";
  if (type === ACCOUNT_DISABLED_NOTIFICATION_TYPE) return "/account-disabled";

  return null;
}

function notificationRouteKey(route: NotificationRoute): string {
  return typeof route === "string" ? route : `${route.pathname}?${new URLSearchParams(route.params).toString()}`;
}

/** Sin los grupos de rutas (`(app)`, `(tabs)`), que no forman parte de la URL que reporta `usePathname()`. */
function normalizePath(path: string): string {
  const withoutGroups = path.replace(/\/\([^/)]+\)/g, "");
  return withoutGroups.length > 1 ? withoutGroups.replace(/\/+$/, "") : withoutGroups || "/";
}

interface CurrentLocation {
  pathname: string;
  params: Record<string, string | string[] | undefined>;
}

/**
 * ¿La pantalla a la que lleva la notificación ya es la que está abierta? Compara la ruta sin grupos y, si la ruta trae
 * parámetros (p. ej. el feed filtrado por `tripId`), que coincidan: mismo path con otro viaje es otra pantalla.
 */
export function isSameRoute(route: NotificationRoute, current: CurrentLocation): boolean {
  const target = typeof route === "string" ? route : route.pathname;
  if (normalizePath(target) !== normalizePath(current.pathname)) return false;
  if (typeof route === "string") return true;
  return Object.entries(route.params).every(([key, value]) => current.params[key] === value);
}

/**
 * Navega a la ruta resuelta de una notificación, con dedup por `responseId` — antes
 * duplicado tal cual entre el manejo de cold start y el de foreground/background. Si esa
 * pantalla ya es la actual no apila otra copia (MOVO-301).
 */
function handleNotificationResponse(response: Notifications.NotificationResponse, current: CurrentLocation): void {
  const data = response.notification?.request?.content?.data;
  const route = resolveNotificationRoute(data);
  if (!route) return;

  const responseId =
    response.notification?.request?.identifier ||
    `${notificationRouteKey(route)}-${response.notification?.date ?? Date.now()}`;
  if (!claimNotificationResponse(responseId)) return;
  if (isSameRoute(route, current)) return;

  // MOVO-300 AC4: con la sesión todavía abierta, se cierra con el motivo y el guard de
  // `app/(app)/_layout.tsx` lleva a la pantalla de cuenta inhabilitada.
  if (notificationType(data) === ACCOUNT_DISABLED_NOTIFICATION_TYPE && useAuthStore.getState().status !== "unauthenticated") {
    void useAuthStore.getState().signOutDisabledAccount();
    return;
  }

  // La consulta se abre encima de "Mis consultas": volver lleva a Soporte, no a donde estaba el usuario. Si ya está
  // dentro de Soporte (otra consulta abierta) no se apila otra lista.
  if (typeof route === "string" && route.startsWith("/support/") && !normalizePath(current.pathname).startsWith("/support")) {
    router.push("/support/conversations" as any);
  }

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
  const params = useGlobalSearchParams();
  const locationRef = useRef<CurrentLocation>({ pathname, params });
  locationRef.current = { pathname, params };

  const registeredRef = useRef(false);
  const kycApproved = useAuthStore((s) => s.user?.kycStatus === KycStatus.APPROVED);
  const initialRouteResolved = useBootStore((s) => s.initialRouteResolved);

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
  //
  // También espera a `initialRouteResolved`: `app/index.tsx` hace su propio `replace`
  // de arranque (a `/home` o a `/kyc`, este último tras un `await`) y un `push` que
  // llegue antes queda pisado por ese `replace` -- el deep link se perdía. Con la ruta
  // de arranque ya resuelta, el destino se apila sobre `/home`. Si el usuario terminó en
  // `/kyc` (KYC no aprobado) no se navega: los destinos viven en `(app)`, que exige KYC
  // aprobado, y el toque se descarta.
  useEffect(() => {
    if (sessionStatus !== "authenticated" || !isNavigatorMounted || !initialRouteResolved) {
      return;
    }
    if (!claimColdStart() || !kycApproved) return;

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      handleNotificationResponse(response, locationRef.current);
    });
  }, [sessionStatus, isNavigatorMounted, initialRouteResolved, kycApproved]);

  // MOVO-300: el aviso de inhabilitación abre su pantalla también sin sesión (svc-users
  // revocó todas al inhabilitar). Solo ese tipo: cualquier otro cold start sin sesión se
  // atiende después del login, como antes, así que acá no se reclama.
  useEffect(() => {
    if (sessionStatus !== "unauthenticated" || !isNavigatorMounted) return;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (notificationType(response?.notification?.request?.content?.data) !== ACCOUNT_DISABLED_NOTIFICATION_TYPE) return;
      if (!response || !claimColdStart()) return;
      handleNotificationResponse(response, locationRef.current);
    });
  }, [sessionStatus, isNavigatorMounted]);

  // Manejo de interacción con notificación recibida en foreground / background
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response, locationRef.current);
    });
    return () => subscription.remove();
  }, []);
}
