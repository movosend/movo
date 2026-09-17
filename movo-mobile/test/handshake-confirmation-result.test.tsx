import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { render } from "@testing-library/react-native";
import { HandshakeConfirmationResult } from "../components/handshake/handshake-confirmation-result";
import type { ConfirmHandshakeResult } from "../src/api/shipments-client";

const baseResult: ConfirmHandshakeResult = {
  shipmentId: "shipment-1",
  stage: "pickup",
  previousStatus: ShipmentStatus.ASSIGNED,
  status: ShipmentStatus.IN_TRANSIT,
  distanceM: 12.7,
  confirmedAt: "2026-09-13T13:00:00.000Z",
};

describe("HandshakeConfirmationResult", () => {
  it("muestra el copy de retiro cuando stage es pickup", async () => {
    const { getByText } = await render(<HandshakeConfirmationResult result={baseResult} />);

    expect(getByText("Retiro confirmado")).toBeTruthy();
    expect(getByText("En tránsito")).toBeTruthy();
    expect(getByText("13 m")).toBeTruthy();
  });

  it("muestra el copy de entrega cuando stage es delivery", async () => {
    const { getByText } = await render(
      <HandshakeConfirmationResult
        result={{ ...baseResult, stage: "delivery", status: ShipmentStatus.DELIVERED }}
      />,
    );

    expect(getByText("Entrega confirmada")).toBeTruthy();
    expect(getByText("Entregado")).toBeTruthy();
  });
});
