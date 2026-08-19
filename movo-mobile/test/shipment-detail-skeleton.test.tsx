import { render } from "@testing-library/react-native";
import { ShipmentDetailSkeleton } from "../components/shipments/shipment-detail-skeleton";

describe("ShipmentDetailSkeleton", () => {
  it("renderiza", async () => {
    const { getByTestId } = await render(<ShipmentDetailSkeleton testID="skeleton" />);

    expect(getByTestId("skeleton")).toBeTruthy();
  });
});
