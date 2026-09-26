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
    jest.spyOn(locationService, "clearQueue").mockResolvedValue(undefined);
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

  it("los ejemplos de conexiones mutuas están en un desplegable, cerrado por defecto (MOVO-174)", async () => {
    const { getByText, getByTestId, queryByTestId, queryByText } = await render(<DevShortcutsScreen />);

    expect(getByText("Conexiones mutuas (MOVO-174)")).toBeTruthy();
    // Cerrado: no se renderiza ningún ejemplo.
    expect(queryByTestId("dev-mutual-zero-empty")).toBeNull();
    expect(queryByText(/Ya hizo envíos con/)).toBeNull();

    await fireEvent.press(getByTestId("dev-mutual-toggle"));

    // Con 0 no se renderiza la fila, solo una nota explicativa.
    expect(getByTestId("dev-mutual-zero-empty")).toBeTruthy();
    // Variantes solo conteo, sin nombrar a nadie.
    expect(getByText(/Ya hizo envíos con 1 persona que vos también conocés/)).toBeTruthy();
    expect(getByText(/Ya hizo envíos con 3 personas que vos también conocés/)).toBeTruthy();
    // "99+" cuando el conteo no entra en el núcleo.
    expect(getByTestId("dev-mutual-huge-count", { includeHiddenElements: true })).toHaveTextContent("99+");
    // No hay variantes con nombre: el backend nunca manda `sampleFirstNames`.
    expect(queryByText(/Malena/)).toBeNull();
  });

  it("el desplegable de conexiones mutuas se vuelve a cerrar", async () => {
    const { getByTestId, queryByTestId } = await render(<DevShortcutsScreen />);

    await fireEvent.press(getByTestId("dev-mutual-toggle"));
    expect(getByTestId("dev-mutual-zero-empty")).toBeTruthy();

    await fireEvent.press(getByTestId("dev-mutual-toggle"));
    expect(queryByTestId("dev-mutual-zero-empty")).toBeNull();
  });

  it("inicia y detiene el tracking simulado", async () => {
    const { getByTestId } = await render(<DevShortcutsScreen />);

    await fireEvent.press(getByTestId("dev-toggle-tracking-btn"));
    expect(locationService.startTracking).toHaveBeenCalledWith(["00000000-0000-4000-8000-000000000001"]);
  });

  it("permite encolar una posición offline simulada", async () => {
    const { getByTestId } = await render(<DevShortcutsScreen />);

    await fireEvent.press(getByTestId("dev-enqueue-offline-btn"));
    expect(locationService.enqueuePosition).toHaveBeenCalledWith(
      expect.objectContaining({ shipmentId: "00000000-0000-4000-8000-000000000001" })
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
