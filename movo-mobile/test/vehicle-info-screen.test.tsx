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

const REGISTERED_VEHICLE = {
  brand: "Nissan",
  model: "March",
  cargoCapacityLabel: "Hasta 15 kg · 60 L",
  licensePlate: "AB902ED",
};

async function press(el: unknown) {
  await act(async () => {
    fireEvent.press(el as never);
  });
}

async function typeIn(el: unknown, value: string) {
  await act(async () => {
    fireEvent.changeText(el as never, value);
  });
}

describe("VehicleInfoScreen (MOVO-223: selector de marca/modelo con catálogo)", () => {
  let mutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mutateAsync = jest.fn().mockResolvedValue(REGISTERED_VEHICLE);
    mockUpsertVehicle.mockReturnValue({ mutateAsync, isPending: false });
    mockUseMyVehicle.mockReturnValue({ data: null, isLoading: false });
  });

  it("sin vehículo registrado, muestra el estado vacío y no el formulario", async () => {
    const { getByTestId, queryByTestId } = await render(<VehicleInfoScreen />);

    expect(getByTestId("vehicle-info-register")).toBeTruthy();
    expect(queryByTestId("vehicle-info-plate-input")).toBeNull();
  });

  it("el back del estado vacío sale de la pantalla", async () => {
    const { getByTestId } = await render(<VehicleInfoScreen />);
    await press(getByTestId("vehicle-info-back"));
    expect(router.back).toHaveBeenCalled();
  });

  it("flujo completo por catálogo: marca → modelo → patente → guardar", async () => {
    const { getByTestId, getByText } = await render(<VehicleInfoScreen />);

    await press(getByTestId("vehicle-info-register"));
    expect(getByTestId("vehicle-info-brand-search")).toBeTruthy();

    await press(getByTestId("vehicle-info-brand-Nissan"));
    expect(getByText("March")).toBeTruthy();

    await press(getByTestId("vehicle-info-model-March"));
    expect(getByTestId("vehicle-info-plate-input")).toBeTruthy();

    await typeIn(getByTestId("vehicle-info-plate-input"), "ab123cd");
    expect(getByTestId("vehicle-info-submit").props.accessibilityState?.disabled).toBeFalsy();

    await press(getByTestId("vehicle-info-submit"));

    expect(mutateAsync).toHaveBeenCalledWith({
      brand: "Nissan",
      model: "March",
      cargoCapacityLabel: "Hasta 15 kg · 60 L",
      licensePlate: "AB123CD",
    });
  });

  it("busca marcas por texto en el buscador", async () => {
    const { getByTestId, queryByTestId } = await render(<VehicleInfoScreen />);

    await press(getByTestId("vehicle-info-register"));
    await typeIn(getByTestId("vehicle-info-brand-search"), "toy");

    expect(getByTestId("vehicle-info-brand-Toyota")).toBeTruthy();
    expect(queryByTestId("vehicle-info-brand-Nissan")).toBeNull();
  });

  it("'no encuentro mi marca' permite cargar marca/modelo y volumen a mano", async () => {
    const { getByTestId } = await render(<VehicleInfoScreen />);

    await press(getByTestId("vehicle-info-register"));
    await press(getByTestId("vehicle-info-brand-manual"));

    await typeIn(getByTestId("vehicle-info-manual-brand"), "Chery");
    await typeIn(getByTestId("vehicle-info-manual-model"), "Tiggo 2");
    await press(getByTestId("vehicle-info-manual-tier-L"));

    expect(getByTestId("vehicle-info-continue").props.accessibilityState?.disabled).toBeFalsy();
    await press(getByTestId("vehicle-info-continue"));

    await typeIn(getByTestId("vehicle-info-plate-input"), "AB123CD");
    await press(getByTestId("vehicle-info-submit"));

    expect(mutateAsync).toHaveBeenCalledWith({
      brand: "Chery",
      model: "Tiggo 2",
      cargoCapacityLabel: "Hasta 40 kg · 180 L",
      licensePlate: "AB123CD",
    });
  });

  it("una patente incompleta no habilita guardar y muestra el error de formato", async () => {
    const { getByTestId } = await render(<VehicleInfoScreen />);

    await press(getByTestId("vehicle-info-register"));
    await press(getByTestId("vehicle-info-brand-Nissan"));
    await press(getByTestId("vehicle-info-model-March"));
    await typeIn(getByTestId("vehicle-info-plate-input"), "AB1");

    expect(getByTestId("vehicle-info-plate-error")).toBeTruthy();
    expect(getByTestId("vehicle-info-submit").props.accessibilityState?.disabled).toBe(true);

    await press(getByTestId("vehicle-info-submit"));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("detecta el formato anterior (3 letras + 3 números) al tipear", async () => {
    const { getByTestId, getByText } = await render(<VehicleInfoScreen />);

    await press(getByTestId("vehicle-info-register"));
    await press(getByTestId("vehicle-info-brand-Nissan"));
    await press(getByTestId("vehicle-info-model-March"));
    await typeIn(getByTestId("vehicle-info-plate-input"), "ABC123");

    expect(getByText(/formato anterior/i)).toBeTruthy();
    await press(getByTestId("vehicle-info-submit"));
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ licensePlate: "ABC123" }));
  });

  it("con vehículo registrado, arranca directo en la ficha con sus datos", async () => {
    mockUseMyVehicle.mockReturnValue({ data: REGISTERED_VEHICLE, isLoading: false });

    const { getByText, getByTestId, queryByTestId } = await render(<VehicleInfoScreen />);

    expect(getByText("Nissan March")).toBeTruthy();
    expect(getByText("AB902ED")).toBeTruthy();
    expect(getByTestId("vehicle-info-edit")).toBeTruthy();
    expect(queryByTestId("vehicle-info-register")).toBeNull();
  });

  it("desde la ficha, 'Editar ficha' navega a los accesos de marca/modelo y patente/volumen", async () => {
    mockUseMyVehicle.mockReturnValue({ data: REGISTERED_VEHICLE, isLoading: false });

    const { getByTestId } = await render(<VehicleInfoScreen />);

    await press(getByTestId("vehicle-info-edit"));

    expect(getByTestId("vehicle-info-edit-brand")).toBeTruthy();
    expect(getByTestId("vehicle-info-edit-plate")).toBeTruthy();

    await press(getByTestId("vehicle-info-edit-plate"));
    expect(getByTestId("vehicle-info-plate-input").props.value).toBe("AB902ED");
  });

  it("el back de la ficha (view) sale de la pantalla", async () => {
    mockUseMyVehicle.mockReturnValue({ data: REGISTERED_VEHICLE, isLoading: false });

    const { getByTestId } = await render(<VehicleInfoScreen />);
    await press(getByTestId("vehicle-info-back"));
    expect(router.back).toHaveBeenCalled();
  });
});
