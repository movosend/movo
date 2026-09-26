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

// `RatingSheet` (sección de MOVO-173) usa mutaciones de TanStack Query; esta pantalla se
// renderiza acá sin `QueryClientProvider`.
jest.mock("../src/hooks/use-ratings", () => ({
  useCreateRating: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateRating: () => ({ mutateAsync: jest.fn(), isPending: false }),
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
    expect(getByText("Calificación por categorías (MOVO-173)")).toBeTruthy();
    expect(getByTestId("dev-toggle-tracking-btn")).toBeTruthy();
  });

  it("abre el sheet de calificación con las categorías del rol elegido", async () => {
    const { getByTestId, getByText, queryByText, queryByTestId } = await render(<DevShortcutsScreen />);

    // Cerrado por defecto.
    expect(queryByText("Detalle de la experiencia (opcional)")).toBeNull();

    await fireEvent.press(getByTestId("dev-rating-carrier-btn"));
    expect(getByTestId("dev-rating-sheet-category-punctuality")).toBeTruthy();

    await fireEvent.press(getByTestId("dev-rating-sheet-close"));
    await fireEvent.press(getByTestId("dev-rating-sender-btn"));
    expect(getByTestId("dev-rating-sheet-category-punctuality")).toBeTruthy();
    expect(queryByTestId("dev-rating-sheet-category-care")).toBeNull();
    expect(getByText("Detalle de la experiencia (opcional)")).toBeTruthy();
  });

  it("el receptor comparte las categorías del emisor y la vista previa del perfil trae las barras", async () => {
    const { getByTestId, queryByTestId, queryByText, getByText } = await render(<DevShortcutsScreen />);

    // Vista previa del perfil: barras del rol activo (transportista por defecto).
    expect(getByText("Cuidado del paquete")).toBeTruthy();
    await fireEvent.press(getByTestId("dev-rating-reputation-preview-role-sender"));
    // El emisor no tiene "Cuidado del paquete".
    expect(queryByText("Cuidado del paquete")).toBeNull();

    await fireEvent.press(getByTestId("dev-rating-receiver-btn"));
    expect(getByTestId("dev-rating-sheet-category-punctuality")).toBeTruthy();
    expect(queryByTestId("dev-rating-sheet-category-care")).toBeNull();
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
