import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import DevShortcutsScreen from "../components/dev/DevShortcutsScreen";
import { locationService } from "../src/location/location-service";
import { router } from "expo-router";

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    back: jest.fn(),
  },
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

jest.mock("../src/hooks/use-theme-colors", () => ({
  useThemeColors: () => ({
    fg: "#FFFFFF",
    fg1: "#FFFFFF",
    fg2: "#A1A1AA",
    fg3: "#71717A",
    border: "#27272A",
    bg: "#0A0A0B",
    bgSub: "#111113",
  }),
}));

describe("DevShortcutsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(locationService, "startTracking").mockResolvedValue(undefined);
    jest.spyOn(locationService, "stopTracking").mockResolvedValue(undefined);
    jest.spyOn(locationService, "enqueuePosition").mockImplementation(jest.fn());
    jest.spyOn(locationService, "flushQueue").mockResolvedValue(undefined);
  });

  it("renderiza todos los grupos de atajos en modo dev", async () => {
    const { getByText, getByTestId } = await render(<DevShortcutsScreen />);

    expect(getByText("Atajos de desarrollo")).toBeTruthy();
    expect(getByText("Emisión de ubicación (MOVO-203)")).toBeTruthy();
    expect(getByText("Ruta Optimizada (Demo)")).toBeTruthy();
    expect(getByText("Identidad y KYC")).toBeTruthy();
    expect(getByTestId("dev-toggle-tracking-btn")).toBeTruthy();
  });

  it("inicia y detiene el tracking simulado", async () => {
    const { getByTestId } = await render(<DevShortcutsScreen />);

    await fireEvent.press(getByTestId("dev-toggle-tracking-btn"));
    expect(locationService.startTracking).toHaveBeenCalledWith(["shipment-dev-demo"]);
  });

  it("permite encolar una posición offline simulada", async () => {
    const { getByTestId } = await render(<DevShortcutsScreen />);

    await fireEvent.press(getByTestId("dev-enqueue-offline-btn"));
    expect(locationService.enqueuePosition).toHaveBeenCalledWith(
      expect.objectContaining({ shipmentId: "shipment-dev-demo" })
    );
  });

  it("navega al recorrido demo de ruta optimizada", async () => {
    const { getByTestId } = await render(<DevShortcutsScreen />);

    await fireEvent.press(getByTestId("dev-route-demo-btn"));
    expect(router.push).toHaveBeenCalledWith("/route?demo=true");
  });

  it("navega a las pantallas de KYC y Handshake", async () => {
    const { getByTestId } = await render(<DevShortcutsScreen />);

    await fireEvent.press(getByTestId("dev-kyc-manual-review-btn"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/kyc",
      params: { status: "manual_review" },
    });

    await fireEvent.press(getByTestId("dev-handshake-btn"));
    expect(router.push).toHaveBeenCalledWith("/dev-handshake");
  });
});
