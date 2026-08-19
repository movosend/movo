import { act, fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { Alert } from "react-native";
import SavedAddressesScreen from "../app/(app)/addresses";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock("../src/hooks/use-addresses", () => ({
  useAddresses: jest.fn(),
  useCreateAddress: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useUpdateAddress: jest.fn(() => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false })),
  useDeleteAddress: jest.fn(() => ({ mutate: jest.fn() })),
}));

// Los sheets de "agregar"/"editar"/"confirmar" ya tienen su propia cobertura
// (address-field.test.tsx cubre AddressSearchSheet, edit-address-sheet.test.tsx
// cubre EditAddressSheet, confirm-add-address-sheet.test.tsx cubre
// ConfirmAddAddressSheet) — acá se testea solo la orquestación de la pantalla:
// estados de carga/error/vacío, lista con estrella de default, confirmación de
// borrado, y que elegir una dirección abre el paso de confirmación (no guarda sola).
jest.mock("../components/send/address-search-sheet", () => {
  const { Pressable, Text } = require("react-native");
  return {
    AddressSearchSheet: ({ visible, onSelect, testID }: any) =>
      visible ? (
        <Pressable testID={`${testID}-stub-select`} onPress={() => onSelect(mockStubSelection)}>
          <Text>stub-address-search-sheet</Text>
        </Pressable>
      ) : null,
  };
});

jest.mock("../components/addresses/confirm-add-address-sheet", () => {
  const { Text } = require("react-native");
  return {
    ConfirmAddAddressSheet: ({ visible, selection, testID }: any) =>
      visible ? <Text testID={testID}>{selection?.address}</Text> : null,
  };
});

jest.mock("../components/addresses/edit-address-sheet", () => ({
  EditAddressSheet: () => null,
}));

const mockStubSelection = {
  address: "Av. Colón 1000, Córdoba",
  lat: -31.4,
  lng: -64.18,
  source: "places" as const,
};

import { useAddresses, useDeleteAddress } from "../src/hooks/use-addresses";

const mockUseAddresses = useAddresses as jest.Mock;
const mockUseDeleteAddress = useDeleteAddress as jest.Mock;

const ADDRESS_A = {
  id: "addr-1",
  label: "Casa",
  isDefault: true,
  street: "Av. Colón",
  streetNumber: "1000",
  floorApartment: null,
  city: "Córdoba",
  province: "Córdoba",
  postalCode: "5000",
  country: "Argentina",
  lat: -31.4,
  long: -64.18,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("SavedAddressesScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDeleteAddress.mockReturnValue({ mutate: jest.fn() });
  });

  it("muestra el estado vacío con CTA cuando no hay direcciones (AC7)", async () => {
    mockUseAddresses.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByText, getByTestId } = await render(<SavedAddressesScreen />);

    expect(getByText("Todavía no guardaste ninguna dirección.")).toBeTruthy();
    expect(getByTestId("addresses-empty-add")).toBeTruthy();
  });

  it("muestra el estado de error con reintento (AC7)", async () => {
    const refetch = jest.fn();
    mockUseAddresses.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    const { getByTestId } = await render(<SavedAddressesScreen />);
    fireEvent.press(getByTestId("addresses-retry"));

    expect(refetch).toHaveBeenCalled();
  });

  it("lista las direcciones marcando la default con estrella (AC2)", async () => {
    mockUseAddresses.mockReturnValue({
      data: [ADDRESS_A],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByText, getByTestId } = await render(<SavedAddressesScreen />);

    expect(getByText("Casa")).toBeTruthy();
    expect(getByTestId(`addresses-row-${ADDRESS_A.id}-star`)).toBeTruthy();
  });

  it("pide confirmación antes de borrar y ejecuta la mutación al confirmar (AC6)", async () => {
    const mutate = jest.fn();
    mockUseDeleteAddress.mockReturnValue({ mutate });
    mockUseAddresses.mockReturnValue({
      data: [ADDRESS_A],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      const confirm = buttons?.find((b) => b.style === "destructive");
      confirm?.onPress?.();
    });

    const { getByTestId } = await render(<SavedAddressesScreen />);
    fireEvent.press(getByTestId(`addresses-row-${ADDRESS_A.id}-delete`));

    expect(alertSpy).toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledWith(ADDRESS_A.id);
    alertSpy.mockRestore();
  });

  it("no borra si se cancela la confirmación", async () => {
    const mutate = jest.fn();
    mockUseDeleteAddress.mockReturnValue({ mutate });
    mockUseAddresses.mockReturnValue({
      data: [ADDRESS_A],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      const cancel = buttons?.find((b) => b.style === "cancel");
      cancel?.onPress?.();
    });

    const { getByTestId } = await render(<SavedAddressesScreen />);
    fireEvent.press(getByTestId(`addresses-row-${ADDRESS_A.id}-delete`));

    expect(mutate).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("al elegir una dirección abre el paso de confirmación en vez de guardar sola (fix de feedback)", async () => {
    mockUseAddresses.mockReturnValue({
      data: [ADDRESS_A],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<SavedAddressesScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("addresses-add"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(getByTestId("addresses-search-sheet-stub-select"));
      await Promise.resolve();
    });

    expect(getByTestId("addresses-confirm-add-sheet").props.children).toBe(
      mockStubSelection.address,
    );
  });

  it("vuelve atrás al tocar el botón de back", async () => {
    mockUseAddresses.mockReturnValue({
      data: [ADDRESS_A],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<SavedAddressesScreen />);
    fireEvent.press(getByTestId("addresses-back"));

    expect(router.back).toHaveBeenCalled();
  });
});
