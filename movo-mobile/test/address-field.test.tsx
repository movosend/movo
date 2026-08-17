import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AddressField } from "../components/send/address-field";

jest.mock("../src/api/places-client", () => ({
  placesClient: {
    autocomplete: jest.fn(),
    details: jest.fn(),
  },
}));

jest.mock("../src/hooks/use-addresses", () => ({
  useAddresses: jest.fn(),
  useCreateAddress: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock("../src/lib/location.ts", () => ({
  getCurrentLocation: jest.fn(),
}));

import { placesClient } from "../src/api/places-client";
import { useAddresses } from "../src/hooks/use-addresses";
import { getCurrentLocation } from "../src/lib/location";

const mockAutocomplete = placesClient.autocomplete as jest.Mock;
const mockDetails = placesClient.details as jest.Mock;
const mockUseAddresses = useAddresses as jest.Mock;
const mockGetCurrentLocation = getCurrentLocation as jest.Mock;

// MOVO-83 rediseño de UI: reemplaza el formulario manual de 6 campos por búsqueda
// tipo Uber/PedidosYa (Google Places) — cubre el flujo nuevo completo: abrir la
// hoja de búsqueda, autocomplete debounced, resolver detalle, GPS y direcciones
// guardadas, ya que no existía cobertura previa del formulario que reemplaza.
describe("AddressField", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAddresses.mockReturnValue({ data: [] });
  });

  it("muestra el placeholder cuando no hay dirección elegida", async () => {
    const { getByText } = await render(
      <AddressField testID="pickup" label="Retiro" dotColor="#000" value={null} onChange={jest.fn()} />,
    );
    expect(getByText("Tocá para buscar la dirección")).toBeTruthy();
  });

  it("busca predicciones con debounce y confirma la dirección elegida", async () => {
    mockAutocomplete.mockResolvedValue([{ placeId: "p1", description: "Av. Colón 1000, Córdoba" }]);
    mockDetails.mockResolvedValue({ formattedAddress: "Av. Colón 1000, Córdoba", lat: -31.4, long: -64.18 });
    const onChange = jest.fn();

    const { getByTestId, getByText } = await render(
      <AddressField testID="pickup" label="Retiro" dotColor="#000" value={null} onChange={onChange} />,
    );

    await act(async () => {
      fireEvent.press(getByTestId("pickup"));
      await Promise.resolve();
    });
    fireEvent.changeText(getByTestId("pickup-sheet-input"), "Av. Colón");

    await waitFor(() => expect(mockAutocomplete).toHaveBeenCalledWith("Av. Colón"), { timeout: 1000 });

    await waitFor(() => expect(getByText("Av. Colón 1000, Córdoba")).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByTestId("pickup-sheet-result-p1"));
      await Promise.resolve();
    });

    expect(mockDetails).toHaveBeenCalledWith("p1");
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        address: "Av. Colón 1000, Córdoba",
        lat: -31.4,
        lng: -64.18,
        source: "places",
      }),
    );
  });

  it("usa la ubicación actual por GPS", async () => {
    mockGetCurrentLocation.mockResolvedValue({ granted: true, lat: -31.41, lng: -64.18 });
    const onChange = jest.fn();

    const { getByTestId } = await render(
      <AddressField testID="pickup" label="Retiro" dotColor="#000" value={null} onChange={onChange} />,
    );

    await act(async () => {
      fireEvent.press(getByTestId("pickup"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(getByTestId("pickup-sheet-use-location"));
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenCalledWith({
      address: "Ubicación actual",
      lat: -31.41,
      lng: -64.18,
      source: "gps",
    });
  });

  it("permite elegir una dirección guardada sin llamar a Places", async () => {
    mockUseAddresses.mockReturnValue({
      data: [
        {
          id: "a1",
          label: "Casa",
          isDefault: true,
          street: "San Martín",
          streetNumber: "123",
          floorApartment: null,
          city: "Córdoba",
          province: "Córdoba",
          postalCode: "5000",
          country: "Argentina",
          lat: -31.42,
          long: -64.19,
          createdAt: "",
          updatedAt: "",
        },
      ],
    });
    const onChange = jest.fn();

    const { getByTestId } = await render(
      <AddressField testID="pickup" label="Retiro" dotColor="#000" value={null} onChange={onChange} />,
    );

    await act(async () => {
      fireEvent.press(getByTestId("pickup"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(getByTestId("pickup-sheet-saved-a1"));
      await Promise.resolve();
    });

    expect(mockDetails).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith({ address: "Casa", lat: -31.42, lng: -64.19, source: "saved" });
  });
});
