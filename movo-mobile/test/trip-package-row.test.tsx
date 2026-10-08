import { fireEvent, render } from "@testing-library/react-native";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { TripPackageRow } from "../components/trips/trip-package-row";
import type { TripAcceptedPackage } from "../src/api/trips-client";

const PKG: TripAcceptedPackage = {
  shipmentId: "ship-1",
  status: ShipmentStatus.ASSIGNED,
  packageType: "standard_package",
  weightKg: 2,
  pickupAddress: "Nueva Córdoba, Córdoba",
  pickupLat: -31.42,
  pickupLng: -64.18,
  deliveryAddress: "Villa María, Córdoba",
  deliveryLat: -32.4,
  deliveryLng: -63.24,
  pickupDate: "2026-10-02",
  pickupTimeWindowStart: "07:30:00",
  pickupTimeWindowEnd: "08:00:00",
  agreedPriceArs: 6800,
  senderName: "Martín Ruiz",
};

describe("TripPackageRow (MOVO-263 AC2)", () => {
  it("muestra ruta corta, ventana de retiro, emisor, precio y estado 'Por retirar'", async () => {
    const { getByText, getByTestId } = await render(<TripPackageRow testID="row" pkg={PKG} onPress={jest.fn()} />);

    expect(getByText("Nueva Córdoba")).toBeTruthy();
    expect(getByText("Villa María")).toBeTruthy();
    expect(getByText(/Retiro .*07:30 a 08:00/)).toBeTruthy();
    expect(getByText("Martín Ruiz")).toBeTruthy();
    expect(getByText("MR")).toBeTruthy();
    expect(getByText(/6\.800/)).toBeTruthy();
    expect(getByText("Por retirar")).toBeTruthy();
    expect(getByTestId("row-status")).toBeTruthy();
  });

  it("un envío en tránsito se ve como 'A bordo'", async () => {
    const { getByText } = await render(
      <TripPackageRow pkg={{ ...PKG, status: ShipmentStatus.IN_TRANSIT }} onPress={jest.fn()} />,
    );
    expect(getByText("A bordo")).toBeTruthy();
  });

  it("tocarla dispara onPress", async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(<TripPackageRow testID="row" pkg={PKG} onPress={onPress} />);

    await fireEvent.press(getByTestId("row"));

    expect(onPress).toHaveBeenCalled();
  });
});
