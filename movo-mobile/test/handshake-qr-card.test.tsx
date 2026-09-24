import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Brightness from "expo-brightness";
import { HandshakeQrCard } from "../components/handshake/handshake-qr-card";

jest.mock("react-native-qrcode-svg", () => {
  const { View } = require("react-native");
  return (props: any) => <View testID={props.testID || "handshake-qr-code"} {...props} />;
});

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: "medium", Light: "light" },
}));

describe("HandshakeQrCard (MOVO-159)", () => {
  const defaultProps = {
    qrPayload: JSON.stringify({ shipmentId: "shp-1", nonce: "n-1", signature: "sig-1" }),
    stage: "pickup" as const,
    onRegenerate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renderiza el QR con el aviso de renovación automática, sin countdown ni barra", async () => {
    const { getByTestId, queryByTestId } = await render(<HandshakeQrCard {...defaultProps} />);

    expect(getByTestId("handshake-qr-code")).toBeTruthy();
    expect(getByTestId("handshake-qr-auto-refresh-hint")).toBeTruthy();
    expect(queryByTestId("handshake-qr-countdown-text")).toBeNull();
    expect(queryByTestId("handshake-qr-progress-bar")).toBeNull();
    expect(queryByTestId("handshake-qr-regenerate")).toBeNull();
  });

  it("sube el brillo de la pantalla al mostrarse", async () => {
    await render(<HandshakeQrCard {...defaultProps} />);
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(1));
  });

  it("durante una renovación con QR vigente sigue mostrando el QR, sin spinner", async () => {
    const { getByTestId, queryByText } = await render(<HandshakeQrCard {...defaultProps} isGenerating />);

    expect(getByTestId("handshake-qr-code")).toBeTruthy();
    expect(queryByText("Generando código seguro…")).toBeNull();
  });

  it("muestra spinner en la primera generación (sin QR todavía)", async () => {
    const { getByText, queryByTestId } = await render(
      <HandshakeQrCard {...defaultProps} qrPayload={null} isGenerating />
    );

    expect(getByText("Generando código seguro…")).toBeTruthy();
    expect(queryByTestId("handshake-qr-code")).toBeNull();
  });

  it("ante un error muestra el mensaje y un botón de reintento", async () => {
    const onRegenerate = jest.fn();
    const { getByTestId, getByText, queryByTestId } = await render(
      <HandshakeQrCard
        {...defaultProps}
        qrPayload={null}
        error="No se pudo obtener la ubicación GPS"
        onRegenerate={onRegenerate}
      />
    );

    expect(getByTestId("handshake-qr-error")).toBeTruthy();
    expect(getByText("No se pudo obtener la ubicación GPS")).toBeTruthy();
    expect(queryByTestId("handshake-qr-auto-refresh-hint")).toBeNull();

    await fireEvent.press(getByTestId("handshake-qr-regenerate"));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
