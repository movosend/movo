import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { HandshakeDeviceKeyWarning } from "../components/handshake/handshake-device-key-warning";

describe("HandshakeDeviceKeyWarning (MOVO-159)", () => {
  it("no renderiza nada cuando status es 'ready'", async () => {
    const { queryByTestId } = await render(
      <HandshakeDeviceKeyWarning status="ready" onRetry={jest.fn()} />
    );
    expect(queryByTestId("handshake-device-key-warning")).toBeNull();
  });

  it("renderiza mensaje de preparación cuando status es 'pending'", async () => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <HandshakeDeviceKeyWarning status="pending" onRetry={jest.fn()} />
    );

    expect(getByTestId("handshake-device-key-warning")).toBeTruthy();
    expect(
      getByText("Preparando la clave criptográfica de este dispositivo para la firma segura…")
    ).toBeTruthy();
    expect(queryByTestId("handshake-device-key-retry")).toBeNull();
  });

  it("renderiza advertencia y botón de reintento cuando status es 'error'", async () => {
    const onRetry = jest.fn();
    const { getByTestId, getByText } = await render(
      <HandshakeDeviceKeyWarning status="error" onRetry={onRetry} />
    );

    expect(getByTestId("handshake-device-key-warning")).toBeTruthy();
    expect(
      getByText(
        "No se pudo sincronizar la clave de seguridad del dispositivo. Es requerida para firmar el código QR."
      )
    ).toBeTruthy();

    const retryBtn = getByTestId("handshake-device-key-retry");
    expect(retryBtn).toBeTruthy();

    await fireEvent.press(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
