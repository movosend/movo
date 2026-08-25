import { renderHook } from "@testing-library/react-native";

const mockRouterPush = jest.fn();
const mockUseRootNavigationState = jest.fn().mockReturnValue({ key: "root" });
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
  useRootNavigationState: () => mockUseRootNavigationState(),
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

import { usePushNotifications } from "../src/hooks/use-push-notifications";

describe("usePushNotifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it("limpia el listener de notificaciones al desmontar", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "unauthenticated" }));

    const { unmount } = await renderHook(() => usePushNotifications());
    await unmount();

    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
