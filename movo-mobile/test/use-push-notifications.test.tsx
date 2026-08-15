import { renderHook } from "@testing-library/react-native";

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
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: (...args: unknown[]) =>
    mockAddNotificationResponseReceivedListener(...args),
}));

import { usePushNotifications } from "../src/hooks/use-push-notifications";

describe("usePushNotifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it("AC6: tocar una notificación de envío no crashea aunque no haya pantalla de destino todavía", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "unauthenticated" }));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    await renderHook(() => usePushNotifications());

    expect(mockAddNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
    const listener = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as (response: unknown) => void;

    expect(() =>
      listener({
        notification: { request: { content: { data: { type: "shipment", shipmentId: "shp_1" } } } },
      }),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("shp_1"));

    expect(() =>
      listener({ notification: { request: { content: { data: { type: "other" } } } } }),
    ).not.toThrow();

    warnSpy.mockRestore();
  });

  it("limpia el listener de notificaciones al desmontar", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "unauthenticated" }));

    const { unmount } = await renderHook(() => usePushNotifications());
    await unmount();

    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
