import { ApiError } from "@movo/shared/dist/errors/api-error";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import { HandshakeScanStep } from "../components/handshake/handshake-scan-step";
import { shipmentsClient } from "../src/api/shipments-client";
import { getCurrentLocation } from "../src/lib/location";

jest.mock("../src/api/shipments-client", () => ({
  shipmentsClient: { confirmHandshake: jest.fn() },
}));

jest.mock("../src/lib/location", () => ({
  getCurrentLocation: jest.fn(),
}));

let mockPermission: { granted: boolean; canAskAgain: boolean } | null = {
  granted: true,
  canAskAgain: true,
};
const mockRequestPermission = jest.fn();
let mockBarcodeData = "";

// El componente nativo real no tiene representación en el árbol de React (lo dibuja
// la cámara nativa, no JS) — mismo criterio que el mock de `@react-native-menu/menu`
// (`sender-actions-bar.test.tsx`): un `Pressable` testeable dispara `onBarcodeScanned`
// con el mismo shape que el componente real (`{ data: string }`).
jest.mock("expo-camera", () => {
  const { Pressable, View } = require("react-native");
  return {
    CameraView: ({ testID, onBarcodeScanned, children }: any) => (
      <View testID={testID}>
        <Pressable
          testID={`${testID}-scan-trigger`}
          onPress={() => onBarcodeScanned?.({ data: mockBarcodeData })}
        />
        {children}
      </View>
    ),
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
  };
});

const validPayload = { shipmentId: "shipment-1", nonce: "nonce-1", signature: "sig-1" };

async function triggerScan(getByTestId: (id: string) => any, data: string) {
  mockBarcodeData = data;
  await fireEvent.press(getByTestId("handshake-camera-view-scan-trigger"));
}

describe("HandshakeScanStep", () => {
  const mockOnConfirmed = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockPermission = { granted: true, canAskAgain: true };
    mockBarcodeData = "";
    jest.spyOn(Alert, "alert");
    jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined as never);
  });

  it("pide permiso de cámara cuando todavía no fue otorgado", async () => {
    mockPermission = { granted: false, canAskAgain: true };
    const { getByTestId } = await render(
      <HandshakeScanStep shipmentId="shipment-1" onConfirmed={mockOnConfirmed} />,
    );

    await fireEvent.press(getByTestId("handshake-scan-request-permission"));
    expect(mockRequestPermission).toHaveBeenCalled();
  });

  it("ofrece abrir ajustes cuando el permiso está denegado permanentemente", async () => {
    mockPermission = { granted: false, canAskAgain: false };
    const { getByTestId } = await render(
      <HandshakeScanStep shipmentId="shipment-1" onConfirmed={mockOnConfirmed} />,
    );

    await fireEvent.press(getByTestId("handshake-scan-request-permission"));
    expect(Alert.alert).toHaveBeenCalled();

    const alertButtons = (Alert.alert as jest.Mock).mock.calls[0][2];
    alertButtons.find((b: any) => b.text === "Abrir Ajustes").onPress();
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it("un código escaneado que no es JSON válido muestra error sin llamar al backend", async () => {
    const { getByTestId, getByText } = await render(
      <HandshakeScanStep shipmentId="shipment-1" onConfirmed={mockOnConfirmed} />,
    );

    await triggerScan(getByTestId, "esto no es json");

    await waitFor(() => {
      expect(getByText(/Este código no es válido/)).toBeTruthy();
    });
    expect(shipmentsClient.confirmHandshake).not.toHaveBeenCalled();
    expect(getByTestId("handshake-scan-dismiss")).toBeTruthy();
  });

  it("un JSON válido pero incompleto (sin signature) se trata como código inválido", async () => {
    const { getByTestId, getByText } = await render(
      <HandshakeScanStep shipmentId="shipment-1" onConfirmed={mockOnConfirmed} />,
    );

    await triggerScan(getByTestId, JSON.stringify({ shipmentId: "s1", nonce: "n1" }));

    await waitFor(() => {
      expect(getByText(/Este código no es válido/)).toBeTruthy();
    });
    expect(shipmentsClient.confirmHandshake).not.toHaveBeenCalled();
  });

  it("sin permiso/GPS disponible no llama a confirm y muestra el error explícito (AC3)", async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValue({ granted: false });
    const { getByTestId, getByText } = await render(
      <HandshakeScanStep shipmentId="shipment-1" onConfirmed={mockOnConfirmed} />,
    );

    await triggerScan(getByTestId, JSON.stringify(validPayload));

    await waitFor(() => {
      expect(getByText(/Necesitamos tu ubicación/)).toBeTruthy();
    });
    expect(shipmentsClient.confirmHandshake).not.toHaveBeenCalled();
    // Sin GPS no hay nada que reintentar con el mismo escaneo hasta que se conceda el permiso.
    expect(getByTestId("handshake-scan-retry")).toBeTruthy();
  });

  it("camino feliz: confirma con nonce/signature del QR + GPS propio", async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValue({ granted: true, lat: -31.4, lng: -64.2 });
    const result = {
      shipmentId: "shipment-1",
      stage: "pickup",
      previousStatus: "assigned",
      status: "in_transit",
      distanceM: 12.4,
      confirmedAt: "2026-09-13T10:00:00.000Z",
    };
    (shipmentsClient.confirmHandshake as jest.Mock).mockResolvedValue(result);

    const { getByTestId } = await render(
      <HandshakeScanStep shipmentId="shipment-1" onConfirmed={mockOnConfirmed} />,
    );

    await triggerScan(getByTestId, JSON.stringify(validPayload));

    await waitFor(() => {
      expect(shipmentsClient.confirmHandshake).toHaveBeenCalledWith("shipment-1", {
        nonce: "nonce-1",
        signature: "sig-1",
        lat: -31.4,
        lng: -64.2,
      });
    });
    expect(mockOnConfirmed).toHaveBeenCalledWith(result);
  });

  it.each([
    ["HANDSHAKE_QR_EXPIRED", /venció/],
    ["HANDSHAKE_DISTANCE_EXCEEDED", /más de 100 m/],
    ["HANDSHAKE_INVALID_SIGNATURE", /no es válido/],
    ["HANDSHAKE_CEDENTE_KEY_MISSING", /todavía no puede confirmar/],
    ["HANDSHAKE_INVALID_SHIPMENT_STATE", /ya no está en un estado/],
  ])("mapea %s a un mensaje específico sin cerrar la cámara", async (code, expectedText) => {
    (getCurrentLocation as jest.Mock).mockResolvedValue({ granted: true, lat: -31.4, lng: -64.2 });
    (shipmentsClient.confirmHandshake as jest.Mock).mockRejectedValue(
      new ApiError(code === "HANDSHAKE_QR_EXPIRED" ? 410 : code === "HANDSHAKE_DISTANCE_EXCEEDED" || code === "HANDSHAKE_INVALID_SIGNATURE" ? 422 : 409, code as any, "err"),
    );

    const { getByTestId, getByText } = await render(
      <HandshakeScanStep shipmentId="shipment-1" onConfirmed={mockOnConfirmed} />,
    );

    await triggerScan(getByTestId, JSON.stringify(validPayload));

    await waitFor(() => {
      expect(getByText(expectedText)).toBeTruthy();
    });
    // La cámara sigue montada — el banner se superpone, no la reemplaza.
    expect(getByTestId("handshake-camera-view")).toBeTruthy();

    if (code === "HANDSHAKE_DISTANCE_EXCEEDED") {
      expect(getByTestId("handshake-scan-retry")).toBeTruthy();
    } else {
      expect(getByTestId("handshake-scan-dismiss")).toBeTruthy();
    }
  });

  it("HANDSHAKE_DISTANCE_EXCEEDED: reintentar reenvía el mismo nonce/signature con GPS nuevo", async () => {
    (getCurrentLocation as jest.Mock)
      .mockResolvedValueOnce({ granted: true, lat: -31.4, lng: -64.2 })
      .mockResolvedValueOnce({ granted: true, lat: -31.41, lng: -64.21 });
    (shipmentsClient.confirmHandshake as jest.Mock)
      .mockRejectedValueOnce(new ApiError(422, "HANDSHAKE_DISTANCE_EXCEEDED", "lejos"))
      .mockResolvedValueOnce({
        shipmentId: "shipment-1",
        stage: "delivery",
        previousStatus: "in_transit",
        status: "delivered",
        distanceM: 8,
        confirmedAt: "2026-09-13T10:05:00.000Z",
      });

    const { getByTestId } = await render(
      <HandshakeScanStep shipmentId="shipment-1" onConfirmed={mockOnConfirmed} />,
    );

    await triggerScan(getByTestId, JSON.stringify(validPayload));
    await waitFor(() => expect(getByTestId("handshake-scan-retry")).toBeTruthy());

    await fireEvent.press(getByTestId("handshake-scan-retry"));

    await waitFor(() => expect(mockOnConfirmed).toHaveBeenCalled());
    expect(shipmentsClient.confirmHandshake).toHaveBeenCalledTimes(2);
    expect((shipmentsClient.confirmHandshake as jest.Mock).mock.calls[1][1]).toEqual({
      nonce: "nonce-1",
      signature: "sig-1",
      lat: -31.41,
      lng: -64.21,
    });
  });

  it("volver a escanear tras un error no reintentable limpia el estado y permite un nuevo escaneo", async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValue({ granted: true, lat: -31.4, lng: -64.2 });
    (shipmentsClient.confirmHandshake as jest.Mock)
      .mockRejectedValueOnce(new ApiError(410, "HANDSHAKE_QR_EXPIRED", "vencido"))
      .mockResolvedValueOnce({
        shipmentId: "shipment-1",
        stage: "pickup",
        previousStatus: "assigned",
        status: "in_transit",
        distanceM: 5,
        confirmedAt: "2026-09-13T10:10:00.000Z",
      });

    const { getByTestId } = await render(
      <HandshakeScanStep shipmentId="shipment-1" onConfirmed={mockOnConfirmed} />,
    );

    await triggerScan(getByTestId, JSON.stringify(validPayload));
    await waitFor(() => expect(getByTestId("handshake-scan-dismiss")).toBeTruthy());

    await fireEvent.press(getByTestId("handshake-scan-dismiss"));
    await triggerScan(getByTestId, JSON.stringify(validPayload));

    await waitFor(() => expect(mockOnConfirmed).toHaveBeenCalled());
  });

  it("el atajo de simulación de escaneo (dev) dispara el mismo camino que un escaneo real", async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValue({ granted: true, lat: -31.4, lng: -64.2 });
    (shipmentsClient.confirmHandshake as jest.Mock).mockResolvedValue({
      shipmentId: "shipment-1",
      stage: "pickup",
      previousStatus: "assigned",
      status: "in_transit",
      distanceM: 3,
      confirmedAt: "2026-09-13T10:15:00.000Z",
    });

    const { getByTestId } = await render(
      <HandshakeScanStep shipmentId="shipment-1" onConfirmed={mockOnConfirmed} />,
    );

    fireEvent.changeText(getByTestId("handshake-scan-dev-input"), JSON.stringify(validPayload));
    await waitFor(() => {
      expect(getByTestId("handshake-scan-dev-input").props.value).toBe(JSON.stringify(validPayload));
    });
    await fireEvent.press(getByTestId("handshake-scan-dev-simulate"));

    await waitFor(() => expect(mockOnConfirmed).toHaveBeenCalled());
  });
});
