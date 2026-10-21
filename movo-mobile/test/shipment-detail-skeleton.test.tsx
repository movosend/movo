import { render } from "@testing-library/react-native";
import { ShipmentDetailBodySkeleton } from "../components/shipments/shipment-detail-skeleton";

describe("ShipmentDetailBodySkeleton", () => {
  it("renderiza", async () => {
    const { getByTestId } = await render(<ShipmentDetailBodySkeleton testID="skeleton" />);

    expect(getByTestId("skeleton")).toBeTruthy();
  });
});
