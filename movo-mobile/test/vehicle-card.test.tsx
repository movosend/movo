import { render } from "@testing-library/react-native";
import { VehicleCard } from "../components/profile/vehicle-card";

describe("VehicleCard", () => {
  it("no renderiza nada si no cargó ficha de vehículo (MOVO-172, todavía sin backend)", async () => {
    const { toJSON } = await render(<VehicleCard vehicle={null} />);
    expect(toJSON()).toBeNull();
  });

  it("no renderiza nada si vehicle es undefined", async () => {
    const { toJSON } = await render(<VehicleCard vehicle={undefined} />);
    expect(toJSON()).toBeNull();
  });

  it("muestra marca, modelo, capacidad y patente", async () => {
    const { getByText } = await render(
      <VehicleCard
        vehicle={{
          brand: "Fiat",
          model: "Cronos gris",
          cargoCapacityLabel: "Baúl mediano · hasta 15 kg",
          licensePlate: "AB 123 CD",
        }}
      />
    );

    expect(getByText("Fiat Cronos gris")).toBeTruthy();
    expect(getByText("Baúl mediano · hasta 15 kg")).toBeTruthy();
    expect(getByText("AB 123 CD")).toBeTruthy();
  });
});
