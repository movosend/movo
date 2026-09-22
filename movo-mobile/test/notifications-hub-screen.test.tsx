import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import NotificationsHubScreen from "../app/(app)/profile/notifications/index";

const mockRouterPush = jest.fn();
const mockRouterBack = jest.fn();
jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    back: (...args: unknown[]) => mockRouterBack(...args),
  },
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const React = require("react");
    React.useEffect(() => cb(), [cb]);
  },
}));

const mockUseNotificationPreferences = jest.fn();
const mockMutate = jest.fn();
jest.mock("../src/hooks/use-notification-preferences", () => ({
  useNotificationPreferences: () => mockUseNotificationPreferences(),
  useUpdateNotificationPreferences: () => ({ mutate: mockMutate, isPending: false }),
}));

const mockGetNotificationPermissionStatus = jest.fn();
jest.mock("../src/lib/notification-permission", () => ({
  getNotificationPermissionStatus: () => mockGetNotificationPermissionStatus(),
}));

const PREFS = {
  pushEnabled: true,
  quietHours: { enabled: false, from: "23:00", to: "08:00" },
  categories: [
    { id: "custody", enabled: true },
    { id: "offers", enabled: true },
    { id: "ratings", enabled: false },
    { id: "shipments", enabled: true },
    { id: "trips", enabled: true },
  ],
};

/**
 * MOVO-246: hub de "Notificaciones" — datos reales del catálogo de MOVO-245
 * (`@movo/shared`), no las 12 filas ficticias del prototipo de Claude Design.
 */
describe("NotificationsHubScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNotificationPreferences.mockReturnValue({ data: PREFS, isLoading: false, isError: false });
    mockGetNotificationPermissionStatus.mockResolvedValue({ granted: true, canAskAgain: true });
  });

  it("vuelve atrás desde el header", async () => {
    const { getByTestId } = await render(<NotificationsHubScreen />);

    await fireEvent.press(getByTestId("notifications-hub-back"));

    expect(mockRouterBack).toHaveBeenCalled();
  });

  it("muestra el contador de categorías implementadas activas", async () => {
    const { getByTestId } = await render(<NotificationsHubScreen />);

    expect(getByTestId("notifications-hub-active-count").props.children).toBe("4/5 activas");
  });

  it("navega al horario de silencio", async () => {
    const { getByTestId } = await render(<NotificationsHubScreen />);

    await fireEvent.press(getByTestId("notifications-hub-quiet-hours"));

    expect(mockRouterPush).toHaveBeenCalledWith("/profile/notifications/quiet-hours");
  });

  it("navega al detalle de una categoría implementada", async () => {
    const { getByTestId } = await render(<NotificationsHubScreen />);

    await fireEvent.press(getByTestId("notifications-hub-row-custody-open"));

    expect(mockRouterPush).toHaveBeenCalledWith("/profile/notifications/custody");
  });

  it("una categoría 'Pronto' no tiene toggle funcional", async () => {
    const { getByTestId } = await render(<NotificationsHubScreen />);

    expect(getByTestId("notifications-hub-row-kyc-pending")).toBeTruthy();
    await fireEvent.press(getByTestId("notifications-hub-row-kyc-toggle"));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("togglear el maestro dispara la mutación con pushEnabled", async () => {
    const { getByTestId } = await render(<NotificationsHubScreen />);

    await fireEvent.press(getByTestId("notifications-hub-master-toggle"));

    expect(mockMutate).toHaveBeenCalledWith({ pushEnabled: false }, expect.anything());
  });

  it("togglear una categoría implementada dispara la mutación con su id", async () => {
    const { getByTestId } = await render(<NotificationsHubScreen />);

    await fireEvent.press(getByTestId("notifications-hub-row-custody-toggle"));

    expect(mockMutate).toHaveBeenCalledWith({ categories: { custody: false } }, expect.anything());
  });

  it("muestra el banner de permiso bloqueado cuando el SO lo denegó", async () => {
    mockGetNotificationPermissionStatus.mockResolvedValue({ granted: false, canAskAgain: true });

    const { getByTestId } = await render(<NotificationsHubScreen />);

    await waitFor(() => expect(getByTestId("notifications-hub-permission-banner")).toBeTruthy());
  });

  it("con push bloqueado, oculta el resto de la pantalla (sin funcionalidad real)", async () => {
    mockGetNotificationPermissionStatus.mockResolvedValue({ granted: false, canAskAgain: true });

    const { getByTestId, queryByTestId } = await render(<NotificationsHubScreen />);

    await waitFor(() => expect(getByTestId("notifications-hub-permission-banner")).toBeTruthy());
    expect(queryByTestId("notifications-hub-settings")).toBeNull();
    expect(queryByTestId("notifications-hub-master-toggle")).toBeNull();
    expect(queryByTestId("notifications-hub-quiet-hours")).toBeNull();
  });

  it("muestra el estado de carga mientras obtiene las preferencias", async () => {
    mockUseNotificationPreferences.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    const { getByTestId } = await render(<NotificationsHubScreen />);

    expect(getByTestId("notifications-hub-loading")).toBeTruthy();
  });

  it("muestra un error si falla la carga de preferencias", async () => {
    mockUseNotificationPreferences.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    const { getByTestId } = await render(<NotificationsHubScreen />);

    expect(getByTestId("notifications-hub-error")).toBeTruthy();
  });
});
