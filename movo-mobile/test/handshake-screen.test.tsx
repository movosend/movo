import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import ShipmentHandshakeScreen from "../app/(app)/shipments/[id]/handshake";

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockCanGoBack = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: mockRouterBack,
    replace: mockRouterReplace,
    canGoBack: mockCanGoBack,
  }),
  useLocalSearchParams: () => ({ id: "shp-abc-123" }),
}));

const mockUseShipment = jest.fn();
jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: () => mockUseShipment(),
}));

const mockUsePublicProfile = jest.fn();
jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: () => mockUsePublicProfile(),
}));

const mockCurrentUser = jest.fn();
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector?: (state: any) => any) => {
    const state = { user: mockCurrentUser() };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

const mockUseHandshakeQr = jest.fn();
jest.mock("../src/hooks/use-handshake-qr", () => ({
  useHandshakeQr: (options: any) => mockUseHandshakeQr(options),
}));

// Mock react-native-qrcode-svg
jest.mock("react-native-qrcode-svg", () => {
  const { View } = require("react-native");
  return (props: any) => <View testID="handshake-qr-code" {...props} />;
});

// Mock expo-haptics
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

describe("ShipmentHandshakeScreen (MOVO-159)", () => {
  const defaultShipment = {
    id: "shp-abc-123",
    senderId: "user-sender",
    carrierId: "user-carrier",
    receiverId: "user-receiver",
    status: ShipmentStatus.ASSIGNED,
  };

  const defaultQrHook = {
    status: "active",
    qrPayload: JSON.stringify({ shipmentId: "shp-abc-123", nonce: "n-1", signature: "s-1" }),
    stage: "pickup",
    secondsLeft: 15,
    totalSeconds: 15,
    progressPercent: 100,
    isExpiringSoon: false,
    isExpired: false,
    error: null,
    confirmedShipment: null,
    deviceKeyStatus: "ready",
    retryDeviceKey: jest.fn(),
    regenerate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCanGoBack.mockReturnValue(true);
    mockCurrentUser.mockReturnValue({ userId: "user-sender" });
    mockUseShipment.mockReturnValue({
      data: defaultShipment,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
    mockUsePublicProfile.mockReturnValue({
      data: { id: "user-carrier", fullName: "Lucas Conductor" },
    });
    mockUseHandshakeQr.mockReturnValue(defaultQrHook);
  });

  it("renderiza pantalla de retiro cuando el usuario actual es el emisor", async () => {
    const { getByText, getByTestId } = await render(<ShipmentHandshakeScreen />);

    expect(getByText("Confirmar retiro")).toBeTruthy();
    expect(getByTestId("handshake-qr-code")).toBeTruthy();
    expect(getByText("00:15")).toBeTruthy();
    // Subtítulo con nombre de contraparte
    expect(getByText(/Lucas tiene que escanear este QR/)).toBeTruthy();

    await fireEvent.press(getByTestId("handshake-back-button"));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("renderiza pantalla de entrega cuando el usuario actual es el transportista", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-carrier" });
    mockUseShipment.mockReturnValue({
      data: {
        ...defaultShipment,
        status: ShipmentStatus.IN_TRANSIT,
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
    mockUsePublicProfile.mockReturnValue({
      data: { id: "user-receiver", fullName: "Mariana Destinataria" },
    });
    mockUseHandshakeQr.mockReturnValue({
      ...defaultQrHook,
      stage: "delivery",
    });

    const { getByText } = await render(<ShipmentHandshakeScreen />);

    expect(getByText("Confirmar entrega")).toBeTruthy();
    expect(getByText(/Mariana tiene que escanear este QR/)).toBeTruthy();
  });

  it("muestra advertencia de bootstrap cuando deviceKeyStatus no es ready", async () => {
    mockUseHandshakeQr.mockReturnValue({
      ...defaultQrHook,
      deviceKeyStatus: "error",
    });

    const { getByTestId, getByText } = await render(<ShipmentHandshakeScreen />);

    expect(getByTestId("handshake-device-key-warning")).toBeTruthy();
    expect(getByText(/No se pudo sincronizar la clave de seguridad/)).toBeTruthy();
  });

  it("muestra vista de éxito cuando la transferencia de custodia está confirmada", async () => {
    mockUseHandshakeQr.mockReturnValue({
      ...defaultQrHook,
      status: "confirmed",
      confirmedShipment: {
        ...defaultShipment,
        status: ShipmentStatus.IN_TRANSIT,
      },
    });

    const { getByTestId, getByText } = await render(<ShipmentHandshakeScreen />);

    expect(getByTestId("handshake-success-view")).toBeTruthy();
    expect(getByText("Retiro confirmado")).toBeTruthy();
  });
});
