import { act, fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import VehicleInfoScreen from "../app/(app)/vehicle-info";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const mockUseMyVehicle = jest.fn();
const mockUpsertVehicle = jest.fn();
jest.mock("../src/hooks/use-vehicle", () => ({
  useMyVehicle: () => mockUseMyVehicle(),
  useUpsertVehicle: (options: { onSuccess?: () => void }) => mockUpsertVehicle(options),
}));

async function typeIn(el: unknown, value: string) {
  await act(async () => {
    fireEvent.changeText(el as never, value);
  });
}

describe("VehicleInfoScreen (MOVO-172, todavía sin backend real)", () => {
  let mutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mutateAsync = jest.fn().mockResolvedValue({
      brand: "Renault",
      model: "Sandero blanco",
      cargoCapacityLabel: "Baúl chico · hasta 10 kg",
      licensePlate: "AE742KP",
    });
    mockUpsertVehicle.mockReturnValue({ mutateAsync, isPending: false });
    mockUseMyVehicle.mockReturnValue({ data: null, isLoading: false, isError: false, refetch: jest.fn() });
  });

  it("el botón de guardar arranca deshabilitado sin los 4 campos completos", async () => {
    const { getByTestId } = await render(<VehicleInfoScreen />);
    expect(getByTestId("vehicle-info-submit").props.accessibilityState.disabled).toBe(true);
  });

  it("envía los 4 campos al guardar", async () => {
    const { getByTestId } = await render(<VehicleInfoScreen />);

    await typeIn(getByTestId("vehicle-info-brand"), "Renault");
    await typeIn(getByTestId("vehicle-info-model"), "Sandero blanco");
    await typeIn(getByTestId("vehicle-info-cargo-capacity"), "Baúl chico · hasta 10 kg");
    await typeIn(getByTestId("vehicle-info-license-plate"), "ae742kp");

    await act(async () => {
      fireEvent.press(getByTestId("vehicle-info-submit"));
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      brand: "Renault",
      model: "Sandero blanco",
      cargoCapacityLabel: "Baúl chico · hasta 10 kg",
      licensePlate: "AE742KP",
    });
  });

  it("siembra el formulario con el vehículo ya cargado", async () => {
    mockUseMyVehicle.mockReturnValue({
      data: {
        brand: "Fiat",
        model: "Cronos gris",
        cargoCapacityLabel: "Baúl mediano · hasta 15 kg",
        licensePlate: "AB123CD",
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<VehicleInfoScreen />);

    expect(getByTestId("vehicle-info-brand").props.value).toBe("Fiat");
    expect(getByTestId("vehicle-info-license-plate").props.value).toBe("AB123CD");
  });

  it("muestra el estado de error con reintentar", async () => {
    const refetch = jest.fn();
    mockUseMyVehicle.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    const { getByTestId } = await render(<VehicleInfoScreen />);
    fireEvent.press(getByTestId("vehicle-info-retry"));

    expect(refetch).toHaveBeenCalled();
  });
});
