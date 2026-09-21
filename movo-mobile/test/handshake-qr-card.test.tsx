import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { HandshakeQrCard } from "../components/handshake/handshake-qr-card";

// Mock QRCode component from react-native-qrcode-svg
jest.mock("react-native-qrcode-svg", () => {
  const { View } = require("react-native");
  return (props: any) => <View testID={props.testID || "handshake-qr-code"} {...props} />;
});

// Mock expo-haptics
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: "medium", Light: "light" },
}));

describe("HandshakeQrCard (MOVO-159)", () => {
  const defaultProps = {
    qrPayload: JSON.stringify({ shipmentId: "shp-1", nonce: "n-1", signature: "sig-1" }),
    secondsLeft: 15,
    totalSeconds: 15,
    progressPercent: 100,
    isExpiringSoon: false,
    isExpired: false,
    stage: "pickup" as const,
    onRegenerate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renderiza el QR y contador '00:15' en estado normal", async () => {
    const { getByTestId, queryByTestId } = await render(<HandshakeQrCard {...defaultProps} />);

    expect(getByTestId("handshake-qr-card")).toBeTruthy();
    expect(getByTestId("handshake-qr-code")).toBeTruthy();
    expect(getByTestId("handshake-qr-countdown-text").props.children).toBe("00:15");
    // No debe mostrar botón de regeneración ni overlay de expiración
    expect(queryByTestId("handshake-qr-regenerate")).toBeNull();
    expect(queryByTestId("handshake-qr-expired-overlay")).toBeNull();
  });

  it("muestra el texto en rojo cuando está por vencer (isExpiringSoon = true)", async () => {
    const { getByTestId } = await render(
      <HandshakeQrCard {...defaultProps} secondsLeft={4} progressPercent={26} isExpiringSoon={true} />
    );

    const countdownText = getByTestId("handshake-qr-countdown-text");
    expect(countdownText.props.children).toBe("00:04");
    // Color rojo (#E5484D)
    expect(countdownText.props.style).toEqual(expect.objectContaining({ color: "#E5484D" }));
  });

  it("muestra '00:00', overlay de expirado y botón de regenerar al expirar", async () => {
    const onRegenerate = jest.fn();
    const { getByTestId } = await render(
      <HandshakeQrCard
        {...defaultProps}
        secondsLeft={0}
        progressPercent={0}
        isExpired={true}
        onRegenerate={onRegenerate}
      />
    );

    expect(getByTestId("handshake-qr-countdown-text").props.children).toBe("00:00");
    expect(getByTestId("handshake-qr-expired-overlay")).toBeTruthy();

    const regenBtn = getByTestId("handshake-qr-regenerate");
    expect(regenBtn).toBeTruthy();

    await fireEvent.press(regenBtn);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("muestra spinner mientras se genera el código (isGenerating = true)", async () => {
    const { getByText, queryByTestId } = await render(
      <HandshakeQrCard {...defaultProps} qrPayload={null} isGenerating={true} />
    );

    expect(getByText("Generando código seguro…")).toBeTruthy();
    expect(queryByTestId("handshake-qr-code")).toBeNull();
  });

  it("muestra banner de error si se proporciona error", async () => {
    const { getByTestId, getByText } = await render(
      <HandshakeQrCard {...defaultProps} error="No se pudo obtener la ubicación GPS" />
    );

    expect(getByTestId("handshake-qr-error")).toBeTruthy();
    expect(getByText("No se pudo obtener la ubicación GPS")).toBeTruthy();
  });
});
