import { act, fireEvent, render } from "@testing-library/react-native";
import { ConfirmAddAddressSheet } from "../components/addresses/confirm-add-address-sheet";

jest.mock("../src/hooks/use-addresses", () => ({
  useCreateAddress: jest.fn(),
}));

const mockReverseGeocode = jest.fn();
jest.mock("../src/api/geocode-client", () => ({
  geocodeClient: {
    reverseGeocode: (lat: number, lng: number) => mockReverseGeocode(lat, lng),
  },
}));

import { useCreateAddress } from "../src/hooks/use-addresses";

const mockUseCreateAddress = useCreateAddress as jest.Mock;

const SELECTION = {
  address: "Av. Colón 1000, Córdoba, Córdoba, Argentina",
  lat: -31.4,
  lng: -64.18,
  source: "places" as const,
};

// MOVO-121, fix de feedback: antes se guardaba automáticamente al elegir una
// dirección en el buscador, sin mostrar el mapa para ajustar el pin y sin mostrar el
// error en el paso donde ocurre. Este paso intermedio resuelve las dos cosas.
describe("ConfirmAddAddressSheet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("muestra el mapa para ajustar el pin (AC3 + fix de feedback)", async () => {
    mockUseCreateAddress.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    });

    const { getByTestId } = await render(
      <ConfirmAddAddressSheet
        visible
        selection={SELECTION}
        onClose={jest.fn()}
        onSaved={jest.fn()}
        testID="confirm-sheet"
      />,
    );

    expect(getByTestId("confirm-sheet-map")).toBeTruthy();
    expect(getByTestId("confirm-sheet-marker")).toBeTruthy();
  });

  it("guarda con campos válidos (nunca vacíos) al tocar 'Guardar dirección'", async () => {
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockUseCreateAddress.mockReturnValue({ mutateAsync, isPending: false });
    const onSaved = jest.fn();

    const { getByTestId } = await render(
      <ConfirmAddAddressSheet
        visible
        selection={SELECTION}
        onClose={jest.fn()}
        onSaved={onSaved}
        testID="confirm-sheet"
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId("confirm-sheet-save"));
      await Promise.resolve();
    });

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        street: "Av. Colón",
        streetNumber: "1000",
        city: "Córdoba",
        province: "Córdoba",
        lat: -31.4,
        long: -64.18,
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("muestra el error en este mismo paso si falla el guardado, sin cerrarse", async () => {
    const mutateAsync = jest.fn().mockRejectedValue(new Error("network"));
    mockUseCreateAddress.mockReturnValue({ mutateAsync, isPending: false });
    const onSaved = jest.fn();

    const { getByTestId } = await render(
      <ConfirmAddAddressSheet
        visible
        selection={SELECTION}
        onClose={jest.fn()}
        onSaved={onSaved}
        testID="confirm-sheet"
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId("confirm-sheet-save"));
      await Promise.resolve();
    });

    expect(getByTestId("confirm-sheet-error")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("resetea el mapa y los datos a guardar al cambiar de selección sin desmontar el sheet (regresión)", async () => {
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockUseCreateAddress.mockReturnValue({ mutateAsync, isPending: false });
    const SECOND_SELECTION = {
      address: "Bv. San Juan 500, Córdoba, Córdoba, Argentina",
      lat: -31.42,
      lng: -64.19,
      source: "places" as const,
    };

    const { getByTestId, rerender } = await render(
      <ConfirmAddAddressSheet
        visible
        selection={SELECTION}
        onClose={jest.fn()}
        onSaved={jest.fn()}
        testID="confirm-sheet"
      />,
    );

    // El `Modal` nunca desmonta sus hijos entre aperturas — este `rerender` simula
    // exactamente eso: el mismo árbol, la prop `selection` cambia (como hace
    // `addresses.tsx` al elegir una segunda dirección sin cerrar y reabrir el sheet).
    await act(async () => {
      rerender(
        <ConfirmAddAddressSheet
          visible
          selection={SECOND_SELECTION}
          onClose={jest.fn()}
          onSaved={jest.fn()}
          testID="confirm-sheet"
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.press(getByTestId("confirm-sheet-save"));
      await Promise.resolve();
    });

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        street: "Bv. San Juan",
        streetNumber: "500",
        lat: -31.42,
        long: -64.19,
      }),
    );
  });
  it("al mover el pin guarda la dirección del punto nuevo", async () => {
    mockReverseGeocode.mockResolvedValue({
      formattedAddress: "Av. Colón 1200, Córdoba, Argentina",
    });
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockUseCreateAddress.mockReturnValue({ mutateAsync, isPending: false });

    const { getByTestId, findByText } = await render(
      <ConfirmAddAddressSheet
        visible
        selection={SELECTION}
        onClose={jest.fn()}
        onSaved={jest.fn()}
        testID="confirm-sheet"
      />,
    );

    await act(async () => {
      fireEvent(getByTestId("confirm-sheet-marker"), "dragEnd", {
        nativeEvent: { coordinate: { latitude: -31.41, longitude: -64.2 } },
      });
      await Promise.resolve();
    });
    expect(await findByText("Av. Colón 1200, Córdoba, Argentina")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("confirm-sheet-save"));
      await Promise.resolve();
    });
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        street: "Av. Colón",
        streetNumber: "1200",
        lat: -31.41,
        long: -64.2,
      }),
    );
  });
});
