import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { Linking } from "react-native";
import LiveTrackingScreen from "../app/(app)/shipments/[id]/tracking";
import { useShipment } from "../src/hooks/use-shipments";
import { usePublicProfile } from "../src/hooks/use-profile";
import { useLivePosition } from "../src/hooks/use-live-position";

// Mocks
jest.mock("../src/hooks/use-shipments");
jest.mock("../src/hooks/use-profile");
jest.mock("../src/hooks/use-live-position");

let mockSearchParams: Record<string, string> = {};
const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    back: (...args: unknown[]) => mockRouterBack(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
  useLocalSearchParams: () => mockSearchParams,
}));

describe("LiveTrackingScreen (MOVO-204 Live Tracking Map Screen)", () => {
  beforeEach(() => {
    mockSearchParams = { id: "shipment-uuid-12345" };
    jest.clearAllMocks();
    jest.spyOn(Linking, "openURL").mockResolvedValue(true as any);
  });

  const mockShipmentData = {
    id: "shipment-uuid-12345",
    senderId: "sender-1",
    receiverId: "receiver-1",
    carrierId: "carrier-1",
    packageType: "standard_package",
    weightKg: 2.4,
    description: "Notebook + Accesorios",
    deliveryAddress: "San Martín 450, Oncativo",
    deliveryLat: -31.9140,
    deliveryLng: -63.6820,
    status: "in_transit",
  };

  const mockCarrierData = {
    id: "carrier-1",
    fullName: "Lucas Benítez",
    photoUrl: "https://example.com/avatar.jpg",
  };

  const mockPositionData = {
    position: {
      lat: -31.3850,
      lng: -64.2250,
      capturedAt: new Date().toISOString(),
    },
    trackingStatus: "live" as const,
    isStale: false,
    isDelivered: false,
    distanceKm: 18.4,
    estimatedArrivalMinutes: 22,
    lastUpdateText: "hace unos segundos",
    isLoadingInitial: false,
  };

  it("renderiza correctamente los componentes principales del diseño Stitch", async () => {
    (useShipment as jest.Mock).mockReturnValue({
      data: mockShipmentData,
      isLoading: false,
    });
    (usePublicProfile as jest.Mock).mockReturnValue({
      data: mockCarrierData,
      isLoading: false,
    });
    (useLivePosition as jest.Mock).mockReturnValue(mockPositionData);

    const { getByTestId, getByText } = await render(<LiveTrackingScreen />);

    // Header y telemetría
    expect(getByTestId("tracking-header")).toBeTruthy();
    expect(getByText("Seguimiento en vivo")).toBeTruthy();

    // Mapa táctico
    expect(getByTestId("live-tracking-map")).toBeTruthy();

    // Bottom sheet y handle
    expect(getByTestId("tracking-bottom-sheet")).toBeTruthy();
    expect(getByTestId("tracking-sheet-handle")).toBeTruthy();

    // Hero ETA Card
    expect(getByTestId("card-hero-eta")).toBeTruthy();
    expect(getByText("Llegada estimada")).toBeTruthy();
    expect(getByText("~22 min (aprox.)")).toBeTruthy();
    expect(getByText("18.4 km hacia destino final")).toBeTruthy();

    // Conductor
    expect(getByTestId("card-driver-info")).toBeTruthy();

    // Paquete y Destino
    expect(getByTestId("card-package-and-destination")).toBeTruthy();
    expect(getByText("Notebook + Accesorios")).toBeTruthy();
    expect(getByText("2.4 kg")).toBeTruthy();
    expect(getByText("San Martín 450, Oncativo")).toBeTruthy();

    // Banner de privacidad ADR-023
    expect(getByTestId("banner-privacy-adr023")).toBeTruthy();
    expect(
      getByText(/Solo ves la ubicación actual del transportista/i)
    ).toBeTruthy();
  });

  it("abre las coordenadas de destino en Google Maps al presionar el botón de destino", async () => {
    (useShipment as jest.Mock).mockReturnValue({
      data: mockShipmentData,
      isLoading: false,
    });
    (usePublicProfile as jest.Mock).mockReturnValue({
      data: mockCarrierData,
      isLoading: false,
    });
    (useLivePosition as jest.Mock).mockReturnValue(mockPositionData);

    const { getByTestId } = await render(<LiveTrackingScreen />);

    const mapsBtn = getByTestId("btn-open-destination-maps");
    await act(async () => {
      await fireEvent.press(mapsBtn);
    });

    expect(Linking.openURL).toHaveBeenCalledWith(
      "https://www.google.com/maps/search/?api=1&query=-31.914,-63.682"
    );
  });

  it("renderiza el modo demo correctamente cuando demo=true", async () => {
    mockSearchParams = { id: "any", demo: "true" };

    (useShipment as jest.Mock).mockReturnValue({ data: null, isLoading: false });
    (usePublicProfile as jest.Mock).mockReturnValue({ data: null, isLoading: false });
    (useLivePosition as jest.Mock).mockReturnValue(mockPositionData);

    const { getByTestId, getByText, getAllByText } = await render(<LiveTrackingScreen />);

    expect(getAllByText("MV-28491").length).toBeGreaterThanOrEqual(1);
    expect(getByText("Lucas Benítez")).toBeTruthy();
    expect(getByTestId("btn-exit-demo")).toBeTruthy();
  });

  it("vuelve atrás al presionar el botón de retroceso", async () => {
    (useShipment as jest.Mock).mockReturnValue({
      data: mockShipmentData,
      isLoading: false,
    });
    (usePublicProfile as jest.Mock).mockReturnValue({
      data: mockCarrierData,
      isLoading: false,
    });
    (useLivePosition as jest.Mock).mockReturnValue(mockPositionData);

    const { getByTestId } = await render(<LiveTrackingScreen />);

    const backBtn = getByTestId("btn-back-tracking");
    await act(async () => {
      await fireEvent.press(backBtn);
    });

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("muestra el overlay de entrega cuando isDelivered es true", async () => {
    (useShipment as jest.Mock).mockReturnValue({
      data: mockShipmentData,
      isLoading: false,
    });
    (usePublicProfile as jest.Mock).mockReturnValue({
      data: mockCarrierData,
      isLoading: false,
    });
    (useLivePosition as jest.Mock).mockReturnValue({
      ...mockPositionData,
      isDelivered: true,
      trackingStatus: "closed",
    });

    const { getByTestId, getByText } = await render(<LiveTrackingScreen />);

    expect(getByTestId("tracking-delivered-overlay")).toBeTruthy();
    expect(getByText("Envío entregado")).toBeTruthy();
  });
});
