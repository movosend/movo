import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { HandshakeSuccessView } from "../components/handshake/handshake-success-view";
import { ShipmentStatus } from "@movo/shared";
import * as Haptics from "expo-haptics";

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light" },
}));

describe("HandshakeSuccessView (MOVO-159)", () => {
  const baseShipment: any = {
    id: "shp-1234-5678-abcd",
    status: ShipmentStatus.IN_TRANSIT,
    senderId: "u-1",
    carrierId: "u-2",
    receiverId: "u-3",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renderiza correctamente para la etapa de retiro (pickup)", async () => {
    const onBack = jest.fn();
    const onHome = jest.fn();

    const { getByText, getByTestId } = await render(
      <HandshakeSuccessView
        shipment={baseShipment}
        stage="pickup"
        onBackToShipment={onBack}
        onGoHome={onHome}
      />
    );

    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
    expect(getByTestId("handshake-success-badge")).toBeTruthy();
    expect(getByText("Retiro confirmado")).toBeTruthy();
    expect(getByText("Movo-shp-1234")).toBeTruthy();
    expect(getByText("Retiro completado")).toBeTruthy();

    await fireEvent.press(getByTestId("handshake-success-back"));
    expect(onBack).toHaveBeenCalledTimes(1);

    await fireEvent.press(getByTestId("handshake-success-home"));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it("renderiza correctamente para la etapa de entrega (delivery)", async () => {
    const deliveryShipment = {
      ...baseShipment,
      status: ShipmentStatus.DELIVERED,
    };

    const { getByText } = await render(
      <HandshakeSuccessView
        shipment={deliveryShipment}
        stage="delivery"
        onBackToShipment={jest.fn()}
        onGoHome={jest.fn()}
      />
    );

    expect(getByText("Entrega confirmada")).toBeTruthy();
    expect(getByText("Entrega completada")).toBeTruthy();
  });
});
