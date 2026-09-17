import { fireEvent, render, waitFor } from "@testing-library/react-native";
import DevHandshakeScreen from "../components/dev/DevHandshakeScreen";
import { shipmentsClient } from "../src/api/shipments-client";
import { signHandshakeNonce } from "../src/crypto/signing";
import { getCurrentLocation } from "../src/lib/location";

jest.mock("../src/api/shipments-client", () => ({
  shipmentsClient: {
    listMine: jest.fn(),
    getById: jest.fn(),
    generateHandshake: jest.fn(),
    confirmHandshake: jest.fn(),
  },
}));

jest.mock("../src/crypto/signing", () => ({
  signHandshakeNonce: jest.fn(),
}));

jest.mock("../src/lib/location", () => ({
  getCurrentLocation: jest.fn(),
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: any) => selector({ user: { userId: "user-sender" } }),
}));

// Mismo mock de `expo-camera` que `handshake-scan-step.test.tsx` — el componente
// real vive adentro de esta pantalla de dev sin cambios.
jest.mock("expo-camera", () => {
  const { View } = require("react-native");
  return {
    CameraView: ({ testID, children }: any) => <View testID={testID}>{children}</View>,
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  };
});

const shipment = {
  id: "shipment-1",
  senderId: "user-sender",
  receiverId: "user-receiver",
  carrierId: "user-carrier",
  status: "assigned",
  pickupAddress: "Av. Colón 1000, Córdoba",
  deliveryAddress: "Bv. San Juan 500, Córdoba",
};

describe("DevHandshakeScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (shipmentsClient.listMine as jest.Mock).mockResolvedValue({ items: [shipment], page: 1, limit: 20, total: 1 });
  });

  it("lista los envíos propios y permite cargar uno tocándolo", async () => {
    (shipmentsClient.getById as jest.Mock).mockResolvedValue(shipment);

    const { getByTestId, getByText } = await render(<DevHandshakeScreen />);

    await waitFor(() => expect(getByTestId("dev-handshake-mine-shipment-1")).toBeTruthy());
    await fireEvent.press(getByTestId("dev-handshake-mine-shipment-1"));

    await waitFor(() => expect(shipmentsClient.getById).toHaveBeenCalledWith("shipment-1"));
    expect(getByText("Emisor")).toBeTruthy();
    expect(getByText("Retiro")).toBeTruthy();
  });

  it("permite cargar un envío pegando su ID a mano", async () => {
    (shipmentsClient.getById as jest.Mock).mockResolvedValue({
      ...shipment,
      senderId: "otro-usuario",
      status: "in_transit",
    });

    const { getByTestId, getByText } = await render(<DevHandshakeScreen />);
    await waitFor(() => expect(shipmentsClient.listMine).toHaveBeenCalled());

    fireEvent.changeText(getByTestId("dev-handshake-id-input"), "shipment-2");
    await waitFor(() => expect(getByTestId("dev-handshake-id-input").props.value).toBe("shipment-2"));
    await fireEvent.press(getByTestId("dev-handshake-load"));

    await waitFor(() => expect(shipmentsClient.getById).toHaveBeenCalledWith("shipment-2"));
    expect(getByText("Ninguno")).toBeTruthy();
    expect(getByText("Entrega")).toBeTruthy();
  });

  it("generar QR de prueba pide GPS, llama a generate, firma y arma el JSON del QR", async () => {
    (shipmentsClient.getById as jest.Mock).mockResolvedValue(shipment);
    (getCurrentLocation as jest.Mock).mockResolvedValue({ granted: true, lat: -31.4, lng: -64.2 });
    (shipmentsClient.generateHandshake as jest.Mock).mockResolvedValue({
      shipmentId: "shipment-1",
      stage: "pickup",
      nonce: "nonce-1",
      canonicalPayload: "shipment-1:pickup:nonce-1",
      expiresAt: "2026-09-13T10:00:15.000Z",
      ttlSeconds: 15,
    });
    (signHandshakeNonce as jest.Mock).mockResolvedValue("signature-1");

    const { getByTestId, getByText } = await render(<DevHandshakeScreen />);
    await waitFor(() => expect(getByTestId("dev-handshake-mine-shipment-1")).toBeTruthy());
    await fireEvent.press(getByTestId("dev-handshake-mine-shipment-1"));
    await waitFor(() => expect(getByTestId("dev-handshake-generate")).toBeTruthy());

    await fireEvent.press(getByTestId("dev-handshake-generate"));

    await waitFor(() => {
      expect(signHandshakeNonce).toHaveBeenCalledWith("shipment-1:pickup:nonce-1");
    });
    expect(shipmentsClient.generateHandshake).toHaveBeenCalledWith("shipment-1", { lat: -31.4, lng: -64.2 });
    expect(
      getByText(JSON.stringify({ shipmentId: "shipment-1", nonce: "nonce-1", signature: "signature-1" })),
    ).toBeTruthy();
  });

  it("sin GPS, generar QR de prueba muestra el error explícito sin llamar a generate", async () => {
    (shipmentsClient.getById as jest.Mock).mockResolvedValue(shipment);
    (getCurrentLocation as jest.Mock).mockResolvedValue({ granted: false });

    const { getByTestId, getByText } = await render(<DevHandshakeScreen />);
    await waitFor(() => expect(getByTestId("dev-handshake-mine-shipment-1")).toBeTruthy());
    await fireEvent.press(getByTestId("dev-handshake-mine-shipment-1"));
    await waitFor(() => expect(getByTestId("dev-handshake-generate")).toBeTruthy());

    await fireEvent.press(getByTestId("dev-handshake-generate"));

    await waitFor(() => expect(getByText(/Necesitamos tu ubicación/)).toBeTruthy());
    expect(shipmentsClient.generateHandshake).not.toHaveBeenCalled();
  });

  it("confirmar desde el paso de escaneo embebido muestra la pantalla de éxito", async () => {
    (shipmentsClient.getById as jest.Mock).mockResolvedValue(shipment);
    (getCurrentLocation as jest.Mock).mockResolvedValue({ granted: true, lat: -31.4, lng: -64.2 });
    (shipmentsClient.confirmHandshake as jest.Mock).mockResolvedValue({
      shipmentId: "shipment-1",
      stage: "pickup",
      previousStatus: "assigned",
      status: "in_transit",
      distanceM: 4,
      confirmedAt: "2026-09-13T10:20:00.000Z",
    });

    const { getByTestId, getByText } = await render(<DevHandshakeScreen />);
    await waitFor(() => expect(getByTestId("dev-handshake-mine-shipment-1")).toBeTruthy());
    await fireEvent.press(getByTestId("dev-handshake-mine-shipment-1"));
    await waitFor(() => expect(getByTestId("dev-handshake-scan-step")).toBeTruthy());

    fireEvent.changeText(
      getByTestId("handshake-scan-dev-input"),
      JSON.stringify({ shipmentId: "shipment-1", nonce: "n1", signature: "s1" }),
    );
    await waitFor(() =>
      expect(getByTestId("handshake-scan-dev-input").props.value).toBe(
        JSON.stringify({ shipmentId: "shipment-1", nonce: "n1", signature: "s1" }),
      ),
    );
    await fireEvent.press(getByTestId("handshake-scan-dev-simulate"));

    await waitFor(() => expect(getByText("Retiro confirmado")).toBeTruthy());
  });
});
