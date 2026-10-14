import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";

const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockScheduleNotificationAsync = jest.fn().mockResolvedValue("id-1");
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: () => mockGetPermissionsAsync(),
  requestPermissionsAsync: () => mockRequestPermissionsAsync(),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() }, useRootNavigationState: jest.fn() }));
jest.mock("../src/store/auth-store", () => ({ useAuthStore: jest.fn() }));
jest.mock("../src/lib/push-registration", () => ({ requestPermissionAndRegisterPushToken: jest.fn() }));
jest.mock("../src/hooks/use-theme-colors", () => ({
  useThemeColors: () => ({ fg2: "#A1A1AA", fg3: "#71717A" }),
}));

import { DevPushRoutingSection, DEV_PUSH_DELAY_SECONDS } from "../components/dev/DevPushRoutingSection";

describe("DevPushRoutingSection (MOVO-281)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPermissionsAsync.mockResolvedValue({ granted: true });
  });

  async function renderExpanded() {
    const screen = await render(<DevPushRoutingSection />);
    await act(async () => {
      fireEvent.press(screen.getByTestId("dev-push-toggle"));
    });
    return screen;
  }

  it("muestra la ruta que resuelve cada tipo y desactiva los que no tienen el id", async () => {
    const screen = await renderExpanded();
    expect(screen.getAllByText("Falta un id para armar la ruta").length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.press(screen.getByTestId("dev-push-Envío cancelado (bug de MOVO-240)"));
    });
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();

    await act(async () => {

      fireEvent.changeText(screen.getByTestId("dev-push-id-shipmentId"), "shp_1");

    });

    expect(screen.getByText("→ /shipments/shp_1/change-receiver")).toBeTruthy();
    expect(screen.getByText("→ /profile/security")).toBeTruthy();
  });

  it("programa una notificación local con el mismo data que manda el backend", async () => {
    const screen = await renderExpanded();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("dev-push-id-shipmentId"), "shp_1");
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("dev-push-id-offerId"), "off_1");
    });

    await act(async () => {

      fireEvent.press(screen.getByTestId("dev-push-Oferta anulada"));

    });

    await waitFor(() =>
      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith({
        content: {
          title: "Prueba: Oferta anulada",
          body: "data.type = offer_voided",
          data: { type: "offer_voided", shipmentId: "shp_1", offerId: "off_1" },
        },
        trigger: { type: "timeInterval", seconds: DEV_PUSH_DELAY_SECONDS },
      })
    );
    expect(screen.getByTestId("dev-push-status").props.children).toContain("Oferta anulada");
  });

  it("sin permiso de notificaciones no programa nada y lo avisa", async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: false });
    mockRequestPermissionsAsync.mockResolvedValue({ granted: false });
    const screen = await renderExpanded();

    await act(async () => {

      fireEvent.press(screen.getByTestId("dev-push-Cambio de contraseña"));

    });

    await waitFor(() => expect(screen.getByTestId("dev-push-status")).toBeTruthy());
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
