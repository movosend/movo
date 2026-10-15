import { renderHook } from "@testing-library/react-native";

const mockRouterPush = jest.fn();
const mockUseRootNavigationState = jest.fn().mockReturnValue({ key: "root" });
let mockPathname = "/home";
let mockSearchParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
  useRootNavigationState: () => mockUseRootNavigationState(),
  usePathname: () => mockPathname,
  useGlobalSearchParams: () => mockSearchParams,
}));

// El registro de respuestas atendidas es de módulo (sobrevive al remonte del hook): cada test arranca con uno limpio.
const mockHandledResponses = new Set<string>();
let mockColdStartResolved = false;
jest.mock("../src/lib/notification-response-log", () => ({
  claimNotificationResponse: (id: string) => {
    if (mockHandledResponses.has(id)) return false;
    mockHandledResponses.add(id);
    return true;
  },
  claimColdStart: () => {
    if (mockColdStartResolved) return false;
    mockColdStartResolved = true;
    return true;
  },
}));

const mockUseAuthStore = jest.fn();
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: { status: string }) => unknown) => mockUseAuthStore(selector),
}));

const mockRequestPermissionAndRegisterPushToken = jest.fn().mockResolvedValue(undefined);
jest.mock("../src/lib/push-registration", () => ({
  requestPermissionAndRegisterPushToken: () => mockRequestPermissionAndRegisterPushToken(),
}));

const mockRemove = jest.fn();
const mockAddNotificationResponseReceivedListener = jest.fn().mockReturnValue({ remove: mockRemove });
const mockGetLastNotificationResponseAsync = jest.fn().mockResolvedValue(null);
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: (...args: unknown[]) =>
    mockAddNotificationResponseReceivedListener(...args),
  getLastNotificationResponseAsync: () => mockGetLastNotificationResponseAsync(),
}));

import { isSameRoute, usePushNotifications } from "../src/hooks/use-push-notifications";

describe("usePushNotifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHandledResponses.clear();
    mockColdStartResolved = false;
    mockPathname = "/home";
    mockSearchParams = {};
    mockGetLastNotificationResponseAsync.mockResolvedValue(null);
  });

  it("no pide permiso ni registra nada si la sesión no está autenticada", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "unauthenticated" }));

    await renderHook(() => usePushNotifications());

    expect(mockRequestPermissionAndRegisterPushToken).not.toHaveBeenCalled();
  });

  it("pide permiso/registra una sola vez al detectar sesión autenticada", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));

    const { rerender } = await renderHook(() => usePushNotifications());
    await rerender({});
    await rerender({});

    expect(mockRequestPermissionAndRegisterPushToken).toHaveBeenCalledTimes(1);
  });

  it("registra de nuevo si la sesión pasa por unauthenticated y vuelve a autenticarse", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));
    const { rerender } = await renderHook(() => usePushNotifications());
    expect(mockRequestPermissionAndRegisterPushToken).toHaveBeenCalledTimes(1);

    mockUseAuthStore.mockImplementation((selector) => selector({ status: "unauthenticated" }));
    await rerender({});

    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));
    await rerender({});

    expect(mockRequestPermissionAndRegisterPushToken).toHaveBeenCalledTimes(2);
  });

  it("AC5 de MOVO-132: tocar una notificación de envío navega directo a /shipments/:id", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));

    await renderHook(() => usePushNotifications());

    expect(mockAddNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (response: unknown) => void;

    listener({
      notification: { request: { content: { data: { type: "shipment", shipmentId: "shp_1" } } } },
    });

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shp_1");
  });

  it("AC6 de MOVO-132: cold start con notificación navega al detalle del envío una vez autenticado y montado el navigator", async () => {
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: { request: { identifier: "notif_cold", content: { data: { type: "shipment", shipmentId: "shp_cold" } } } },
    });
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));
    mockUseRootNavigationState.mockReturnValue({ key: "root" });

    await renderHook(() => usePushNotifications());

    // Esperar microtasks para resolver getLastNotificationResponseAsync
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shp_cold");
  });

  it("no navega en cold start si el navigator todavía no está montado", async () => {
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: { request: { identifier: "notif_cold", content: { data: { type: "shipment", shipmentId: "shp_cold" } } } },
    });
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));
    mockUseRootNavigationState.mockReturnValue(undefined);

    const { rerender } = await renderHook(() => usePushNotifications());
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRouterPush).not.toHaveBeenCalled();

    mockUseRootNavigationState.mockReturnValue({ key: "root" });
    await rerender({});
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shp_cold");
  });

  it("deduplica respuestas idénticas entre cold start y listener", async () => {
    const response = {
      notification: { request: { identifier: "notif_shared_1", content: { data: { type: "shipment", shipmentId: "shp_1" } } } },
    };
    mockGetLastNotificationResponseAsync.mockResolvedValue(response);
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));
    mockUseRootNavigationState.mockReturnValue({ key: "root" });

    await renderHook(() => usePushNotifications());
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRouterPush).toHaveBeenCalledTimes(1);

    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (r: unknown) => void;
    listener(response);

    expect(mockRouterPush).toHaveBeenCalledTimes(1);
  });

  it("MOVO-163: tocar una notificación trip_match navega al feed filtrado por tripId", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));

    await renderHook(() => usePushNotifications());

    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (response: unknown) => void;
    listener({
      notification: { request: { content: { data: { type: "trip_match", tripId: "trip_1", shipmentId: "shp_1" } } } },
    });

    expect(mockRouterPush).toHaveBeenCalledWith({ pathname: "/(app)/(tabs)/transport", params: { tripId: "trip_1" } });
  });

  it("MOVO-284: tocar una push de chat abre la conversación del envío", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));

    await renderHook(() => usePushNotifications());

    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (response: unknown) => void;
    listener({
      notification: { request: { content: { data: { type: "chat_message", shipmentId: "shp_1" } } } },
    });

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shp_1/chat");
  });

  it("MOVO-284: una push de chat sin shipmentId no navega", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));

    await renderHook(() => usePushNotifications());

    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (response: unknown) => void;
    listener({ notification: { request: { content: { data: { type: "chat_message" } } } } });

    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("MOVO-163: un trip_match sin tripId en el payload no navega", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));

    await renderHook(() => usePushNotifications());

    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (response: unknown) => void;
    listener({
      notification: { request: { content: { data: { type: "trip_match", shipmentId: "shp_1" } } } },
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("MOVO-163: cold start con notificación trip_match navega al feed filtrado", async () => {
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: {
        request: { identifier: "notif_trip", content: { data: { type: "trip_match", tripId: "trip_cold" } } },
      },
    });
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));
    mockUseRootNavigationState.mockReturnValue({ key: "root" });

    await renderHook(() => usePushNotifications());
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRouterPush).toHaveBeenCalledWith({ pathname: "/(app)/(tabs)/transport", params: { tripId: "trip_cold" } });
  });

  it("MOVO-281: tocar una notificación trip_auto_created abre el detalle del viaje", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));

    await renderHook(() => usePushNotifications());

    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (response: unknown) => void;
    listener({
      notification: { request: { content: { data: { type: "trip_auto_created", tripId: "trip_2" } } } },
    });

    expect(mockRouterPush).toHaveBeenCalledWith("/carrier/trips/trip_2");
  });

  it("MOVO-281: una cancelación por vencimiento abre el detalle del envío en cold start", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: {
        request: {
          identifier: "cancelled-1",
          content: { data: { type: "shipment_cancelled", shipmentId: "shp_cancelled" } },
        },
      },
    });

    await renderHook(() => usePushNotifications());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shp_cancelled");
  });

  it("MOVO-236: un trip_auto_created sin tripId en el payload no navega", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));

    await renderHook(() => usePushNotifications());

    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (response: unknown) => void;
    listener({
      notification: { request: { content: { data: { type: "trip_auto_created" } } } },
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("MOVO-275: la invitación a recibir un paquete abre la pantalla de la invitación", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));

    await renderHook(() => usePushNotifications());

    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (response: unknown) => void;
    listener({
      notification: {
        request: { content: { data: { type: "receiver_transfer_invite", transferId: "tr-1", shipmentId: "s-1" } } },
      },
    });

    expect(mockRouterPush).toHaveBeenCalledWith("/receiver-transfers/tr-1");
  });

  it("MOVO-275: una novedad de la transferencia abre el detalle del envío", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));

    await renderHook(() => usePushNotifications());

    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (response: unknown) => void;
    listener({
      notification: { request: { content: { data: { type: "receiver_transfer", shipmentId: "s-1" } } } },
    });

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/s-1");
  });

  it("limpia el listener de notificaciones al desmontar", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "unauthenticated" }));

    const { unmount } = await renderHook(() => usePushNotifications());
    await unmount();

    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it("MOVO-301: tocar la push del chat que ya está abierto no apila otra copia", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));
    mockPathname = "/shipments/shp_1/chat";
    await renderHook(() => usePushNotifications());

    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (r: unknown) => void;
    listener({
      notification: { request: { identifier: "n1", content: { data: { type: "chat_message", shipmentId: "shp_1" } } } },
    });
    expect(mockRouterPush).not.toHaveBeenCalled();

    // Un chat distinto sí se abre.
    listener({
      notification: { request: { identifier: "n2", content: { data: { type: "chat_message", shipmentId: "shp_2" } } } },
    });
    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shp_2/chat");
  });

  it("MOVO-301: al remontar el hook (logout → login) no vuelve a navegar la última respuesta del cold start", async () => {
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: { request: { identifier: "notif_cold", content: { data: { type: "chat_message", shipmentId: "shp_1" } } } },
    });
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));

    const first = await renderHook(() => usePushNotifications());
    await new Promise((r) => setTimeout(r, 0));
    expect(mockRouterPush).toHaveBeenCalledTimes(1);

    await first.unmount();
    await renderHook(() => usePushNotifications());
    await new Promise((r) => setTimeout(r, 0));
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
  });

  it("MOVO-301: tocar la push del feed de un viaje ya abierto no apila otra copia (ruta con objeto y grupos)", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));
    // `usePathname()` no trae los grupos `(app)/(tabs)`; la ruta de la push sí.
    mockPathname = "/transport";
    mockSearchParams = { tripId: "t1" };
    await renderHook(() => usePushNotifications());

    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (r: unknown) => void;
    listener({ notification: { request: { identifier: "n1", content: { data: { type: "trip_match", tripId: "t1" } } } } });
    expect(mockRouterPush).not.toHaveBeenCalled();

    // Mismo path con otro viaje es otra pantalla: sí navega.
    listener({ notification: { request: { identifier: "n2", content: { data: { type: "trip_match", tripId: "t2" } } } } });
    expect(mockRouterPush).toHaveBeenCalledWith({ pathname: "/(app)/(tabs)/transport", params: { tripId: "t2" } });
  });
});

describe("isSameRoute (MOVO-301)", () => {
  const at = (pathname: string, params: Record<string, string> = {}) => ({ pathname, params });

  it("ignora los grupos de rutas y la barra final", () => {
    expect(isSameRoute("/(app)/shipments/s1/chat", at("/shipments/s1/chat"))).toBe(true);
    expect(isSameRoute("/(app)/(tabs)/home", at("/home/"))).toBe(true);
    expect(isSameRoute("/shipments/s1/chat", at("/shipments/s2/chat"))).toBe(false);
  });

  it("con parámetros exige que coincidan", () => {
    const route = { pathname: "/(app)/(tabs)/transport", params: { tripId: "t1" } };
    expect(isSameRoute(route, at("/transport", { tripId: "t1" }))).toBe(true);
    expect(isSameRoute(route, at("/transport", { tripId: "t2" }))).toBe(false);
    expect(isSameRoute(route, at("/transport"))).toBe(false);
  });
});
