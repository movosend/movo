import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { render } from "@testing-library/react-native";
import { ShipmentStatusBadge } from "../components/shipments/status-badge";

describe("ShipmentStatusBadge", () => {
  it("muestra la etiqueta en español del estado", async () => {
    const { getByText } = await render(<ShipmentStatusBadge status={ShipmentStatus.IN_TRANSIT} />);
    expect(getByText("En camino")).toBeTruthy();
  });

  it("muestra el estado publicado con su etiqueta", async () => {
    const { getByText } = await render(<ShipmentStatusBadge status={ShipmentStatus.PUBLISHED} />);
    expect(getByText("Publicado")).toBeTruthy();
  });
});
