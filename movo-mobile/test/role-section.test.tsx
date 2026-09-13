import { render } from "@testing-library/react-native";
import type { ActiveShipmentSummary } from "../src/api/shipments-client";
import { RoleSection } from "../components/home/role-section";

function makeShipment(id: string): ActiveShipmentSummary {
  return {
    id,
    status: "assigned",
    pickupDate: "2026-09-15",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    pickupAddress: "Córdoba 1200, Córdoba",
    deliveryAddress: "San Martín 450, Córdoba",
    agreedPriceArs: 4500,
    counterparty: { name: "Lucía Gómez", initials: "LG" },
    isToday: false,
    pickupWindowExpired: false,
  };
}

describe("RoleSection (MOVO-193 AC1/AC2)", () => {
  it("no se renderiza (ni el testID) sin envíos activos", async () => {
    const { queryByTestId } = await render(
      <RoleSection testID="sending" title="Estoy enviando" role="sending" shipments={[]} />,
    );

    expect(queryByTestId("sending")).toBeNull();
  });

  it("renderiza el título y una card por cada envío activo", async () => {
    const { getByTestId, getByText } = await render(
      <RoleSection
        testID="sending"
        title="Estoy enviando"
        role="sending"
        shipments={[makeShipment("s1"), makeShipment("s2")]}
      />,
    );

    expect(getByText("Estoy enviando")).toBeTruthy();
    expect(getByTestId("sending-card-s1")).toBeTruthy();
    expect(getByTestId("sending-card-s2")).toBeTruthy();
  });
});
